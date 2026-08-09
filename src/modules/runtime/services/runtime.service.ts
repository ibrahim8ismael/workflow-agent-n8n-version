import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToolSet } from 'ai';
import { jsonSchema, tool } from 'ai';
import type { ExecutionMode } from '../../../infrastructure/llm-runtime/interfaces/llm-runtime.interface';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import {
  buildConversationSystemPrompt,
  buildEmployeeSystemPrompt,
} from '../../../infrastructure/prompts/system-prompts';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import { type Plan } from '../../planner/interfaces/plan.interface';
import { PlannerService } from '../../planner/planner.service';
import { RunsService } from '../../runs/runs.service';
import { SkillsService } from '../../skills/services/skills.service';
import { RuntimeCacheService } from '../shared/runtime-cache.service';
import {
  SkillEmployeeRuntimeService,
  type SkillManifest,
} from '../skill/skill-employee-runtime.service';
import { generateWorkflow, type WorkflowDefinition } from '../types/workflow.types';
import { ContextBuilderService } from './context-builder.service';
export interface ExecuteRequest {
  userMessage: string;
  agentId: string;
  conversationId?: string;
  effort?: ExecutionMode;
  userId?: string;
  organizationId?: string;
}

export interface ExecuteResponse {
  runId: string;
  conversationId?: string;
  response: string;
  mode?: string;
  status?: string;
  plan?: unknown;
  workflow?: WorkflowDefinition;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

type SkillContext = SkillManifest;

@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);

  constructor(
    private readonly runsService: RunsService,
    private readonly agentsService: AgentsService,
    private readonly plannerService: PlannerService,
    private readonly llmRuntime: LLMRuntimeService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly conversationsService: ConversationsService,
    private readonly memoryService: MemoryService,
    private readonly skillsService: SkillsService,
    readonly _knowledgeService: KnowledgeService,
    readonly _configService: ConfigService,
    private readonly skillRuntime: SkillEmployeeRuntimeService,
    private readonly runtimeCache: RuntimeCacheService,
  ) {}

  async execute(request: ExecuteRequest): Promise<ExecuteResponse> {
    const run = await this.runsService.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
    });

    try {
      await this.runsService.transitionStatus(run.id, 'PREPARING');

      const agent = await this.loadAgent(request.agentId, true, {
        userId: request.userId,
        organizationId: request.organizationId,
      });

      await this.runsService.transitionStatus(run.id, 'PLANNING');

      const agentSkills = await this.loadAgentSkills(request.agentId);
      const availableSkills = (
        await Promise.all(
          agentSkills
            .filter((s) => s.enabled)
            .map(async (s) => {
              try {
                const skill = await this.loadSkill(s.skillId);
                return {
                  id: s.id,
                  skillId: s.skillId,
                  name: skill.name,
                  slug: skill.slug,
                  description: skill.description ?? undefined,
                  executionMode: skill.executionMode,
                  status: skill.status,
                  instructions: skill.instructions ?? undefined,
                  timeout: skill.timeout ?? undefined,
                  inputSchema: (skill.inputSchema as Record<string, unknown> | null) ?? undefined,
                  outputSchema: (skill.outputSchema as Record<string, unknown> | null) ?? undefined,
                  retryPolicy: (skill.retryPolicy as Record<string, unknown> | null) ?? undefined,
                };
              } catch {
                return null;
              }
            }),
        )
      ).filter(Boolean) as SkillContext[];

      const conversationHistory = request.conversationId
        ? (await this.conversationsService.getMessages(request.conversationId)).map((m) => ({
            role: m.role,
            content: m.content,
          }))
        : [];

      const plan = await this.plannerService.createPlan({
        userMessage: request.userMessage,
        agentId: request.agentId,
        agentInstructions: agent.instructions ?? undefined,
        conversationId: request.conversationId,
        organizationId: request.organizationId ?? agent.organizationId ?? undefined,
        availableSkills,
        conversationHistory,
        effort: request.effort ?? 'medium',
      });

      if (plan.intent !== 'task_execution') {
        await this.runsService.savePlan(run.id, plan as unknown as Record<string, unknown>);
        return this.respondConversationally(
          run.id,
          request,
          agent.instructions,
          conversationHistory,
        );
      }

      const validation = await this.plannerService.validatePlan(plan);
      if (!validation.valid) {
        return this.failRun(run.id, `Invalid plan: ${validation.errors.join(', ')}`);
      }

      await this.runsService.savePlan(run.id, plan as unknown as Record<string, unknown>);
      await this.runsService.updateMetadata(run.id, {
        userMessage: request.userMessage,
        userId: request.userId,
        organizationId: request.organizationId,
        approvalStatus: 'PENDING',
      });

      if (plan.missingInputs && plan.missingInputs.length > 0) {
        return this.waitingRun(run.id, this.formatClarification(plan.missingInputs), plan);
      }

      return this.waitingRun(run.id, 'The execution plan is ready for your approval.', plan);
    } catch (error) {
      return this.handleFailure(run.id, error);
    }
  }

  private formatClarification(missingInputs: Array<{ description: string }>): string {
    const questions = missingInputs
      .map(({ description }) => description.trim())
      .filter(Boolean)
      .filter((description) => !/\b(no|empty|available) skills?\b|skill list/i.test(description));

    const usefulQuestions =
      questions.length > 0
        ? questions
        : [
            'What should this employee do day to day?',
            'Which tools or channels should it use, such as Gmail, Outlook, WhatsApp, or Slack?',
            'Who should receive its messages or updates?',
          ];

    return [
      'I can help you design that employee. A few details will help me get it right:',
      '',
      ...usefulQuestions.map((question) => `- ${question}`),
      '',
      'You can answer in your own words, and we can refine the setup together.',
    ].join('\n');
  }

  private async respondConversationally(
    runId: string,
    request: ExecuteRequest,
    agentInstructions: string | null | undefined,
    conversationHistory: Array<{ role: string; content: string }>,
  ): Promise<ExecuteResponse> {
    const context = await this.contextBuilder.build({
      systemPrompt: buildConversationSystemPrompt({
        agentInstructions: agentInstructions ?? undefined,
      }),
      agentId: request.agentId,
      conversationId: request.conversationId,
      organizationId: request.organizationId,
      userMessage: request.userMessage,
      conversationHistory,
    });
    const result = await this.llmRuntime.generateText({
      mode: request.effort ?? 'medium',
      systemPrompt: context.system,
      messages: context.messages.map((message) => ({
        role: message.role as 'system' | 'user' | 'assistant',
        content: message.content,
      })),
      temperature: 0.7,
      maxTokens: 1200,
    });

    await this.runsService.updateUsage(runId, result.usage);
    await this.runsService.updateMetadata(runId, {
      intent: 'conversation',
      execution: result.execution,
    });

    if (request.conversationId) {
      await this.conversationsService.addMessage(request.conversationId, {
        role: 'user',
        content: request.userMessage,
      });
      await this.conversationsService.titleFromFirstMessage?.(
        request.conversationId,
        request.userMessage,
      );
      await this.conversationsService.addMessage(request.conversationId, {
        role: 'assistant',
        content: result.content,
      });
    }

    return this.completeRun(runId, result.content, undefined, request.conversationId);
  }

  async approve(runId: string): Promise<ExecuteResponse> {
    const run = await this.runsService.findById(runId);
    if (run.status !== 'WAITING') {
      return this.failRun(runId, `Run cannot be approved from status ${run.status}`);
    }

    const plan = run.plan as unknown as Plan | null;
    if (!plan) return this.failRun(runId, 'Run has no execution plan');
    if (plan.missingInputs?.length > 0) {
      return {
        runId,
        status: 'WAITING',
        response: `I need more information:\n${plan.missingInputs.map((input) => `- ${input.description}`).join('\n')}`,
        plan,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    const workflow = generateWorkflow(plan);
    const currentMetadata = (run.metadata as Record<string, unknown> | null) ?? {};
    await this.runsService.updateMetadata(runId, {
      ...currentMetadata,
      approvalStatus: 'APPROVED',
      workflow,
    });
    await this.runsService.transitionStatus(runId, 'EXECUTING');

    const metadata = currentMetadata;
    return this.executeApproved(
      runId,
      plan,
      {
        userMessage: String(metadata.userMessage ?? ''),
        agentId: run.agentId,
        conversationId: run.conversationId ?? undefined,
        userId: typeof metadata.userId === 'string' ? metadata.userId : undefined,
        organizationId:
          typeof metadata.organizationId === 'string' ? metadata.organizationId : undefined,
      },
      workflow,
    );
  }

  async reject(runId: string, reason?: string): Promise<ExecuteResponse> {
    const run = await this.runsService.findById(runId);
    if (run.status !== 'WAITING') {
      return this.failRun(runId, `Run cannot be rejected from status ${run.status}`);
    }
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    await this.runsService.updateMetadata(runId, {
      ...metadata,
      approvalStatus: 'REJECTED',
      rejectionReason: reason ?? 'Plan rejected by user',
    });
    await this.runsService.cancel(runId);
    return {
      runId,
      status: 'CANCELLED',
      response: reason ?? 'Execution plan rejected.',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private async executeApproved(
    runId: string,
    plan: Plan,
    request: ExecuteRequest,
    workflow: WorkflowDefinition,
  ): Promise<ExecuteResponse> {
    try {
      const agent = await this.loadAgent(request.agentId, true, {
        userId: request.userId,
        organizationId: request.organizationId,
      });
      const agentSkills = await this.loadAgentSkills(request.agentId);
      const availableSkills = (
        await Promise.all(
          agentSkills
            .filter((s) => s.enabled)
            .map(async (s) => {
              try {
                const skill = await this.loadSkill(s.skillId);
                return {
                  id: s.id,
                  skillId: s.skillId,
                  name: skill.name,
                  slug: skill.slug,
                  description: skill.description ?? undefined,
                  executionMode: skill.executionMode,
                  status: skill.status,
                  instructions: skill.instructions ?? undefined,
                  timeout: skill.timeout ?? undefined,
                  inputSchema: (skill.inputSchema as Record<string, unknown> | null) ?? undefined,
                  outputSchema: (skill.outputSchema as Record<string, unknown> | null) ?? undefined,
                  retryPolicy: (skill.retryPolicy as Record<string, unknown> | null) ?? undefined,
                };
              } catch {
                return null;
              }
            }),
        )
      ).filter(Boolean) as SkillContext[];

      const conversationHistory = request.conversationId
        ? (await this.conversationsService.getMessages(request.conversationId)).map((m) => ({
            role: m.role,
            content: m.content,
          }))
        : [];

      const context = await this.contextBuilder.build({
        systemPrompt: buildEmployeeSystemPrompt({
          name: agent.name,
          description: agent.description ?? `${agent.name} business employee`,
          instructions:
            agent.instructions ?? 'Follow the approved work plan and employee policies.',
          plan:
            plan.steps.length > 0
              ? `Goal: ${plan.goal}\n\nSteps:\n${plan.steps.map((s) => `${s.order}. ${s.skillName}`).join('\n')}`
              : undefined,
        }),
        agentId: request.agentId,
        conversationId: request.conversationId,
        organizationId: request.organizationId,
        userMessage: request.userMessage,
        conversationHistory,
      });

      const skillsById = new Map(availableSkills.map((skill) => [skill.skillId, skill]));
      const tools: ToolSet = Object.fromEntries(
        plan.steps.map((step) => {
          const skill = skillsById.get(step.skillId);
          const executor: (args: Record<string, unknown>) => Promise<unknown> = (args) =>
            this.executeSkill(step, skill, args, request);
          return [
            step.skillName,
            tool({
              description: `Execute the "${step.skillName}" skill${
                skill?.description ? `: ${skill.description}` : ''
              }.`,
              inputSchema: jsonSchema({
                type: 'object',
                additionalProperties: true,
              }),
              execute: executor,
            }),
          ];
        }),
      );

      const result = await this.llmRuntime.generateText({
        mode: 'medium',
        systemPrompt: context.system,
        messages: context.messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        sdkTools: tools,
        temperature: 0.7,
        maxTokens: 2000,
      });

      await this.runsService.updateUsage(runId, result.usage);
      await this.runsService.updateMetadata(runId, {
        execution: result.execution,
      });

      if (request.conversationId) {
        await this.conversationsService.addMessage(request.conversationId, {
          role: 'user',
          content: request.userMessage,
        });
        await this.conversationsService.titleFromFirstMessage?.(
          request.conversationId,
          request.userMessage,
        );
        await this.conversationsService.addMessage(request.conversationId, {
          role: 'assistant',
          content: result.content,
        });
      }

      try {
        await this.memoryService.upsert(
          request.agentId,
          `last-conversation-${request.conversationId ?? 'unknown'}`,
          'CONVERSATION',
          `User: ${request.userMessage}\nAssistant: ${result.content}`,
        );
      } catch {
        // Memory storage is best-effort
      }

      return this.completeRun(runId, result.content, workflow, request.conversationId);
    } catch (error) {
      return this.handleFailure(runId, error);
    }
  }

  private async handleFailure(runId: string, error: unknown): Promise<ExecuteResponse> {
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `Run ${runId} failed: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    await this.runsService.fail(runId, message);
    return {
      runId,
      status: 'FAILED',
      response: `An error occurred: ${message}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private async loadAgent(
    agentId: string,
    includeSkills = false,
    scope?: { userId?: string; organizationId?: string },
  ) {
    const key = `agent:${includeSkills ? 'full' : 'profile'}:${agentId}:${scope?.userId ?? ''}:${scope?.organizationId ?? ''}`;
    const cached = await this.runtimeCache.get<Awaited<ReturnType<AgentsService['findById']>>>(key);
    if (cached) return cached;
    const agent = await this.agentsService.findById(agentId, includeSkills, scope);
    void this.runtimeCache.set(key, agent, 60);
    return agent;
  }

  private async loadAgentSkills(agentId: string) {
    const key = `agent-skills:${agentId}`;
    const cached =
      await this.runtimeCache.get<Awaited<ReturnType<AgentsService['getSkills']>>>(key);
    if (cached) return cached;
    const skills = await this.agentsService.getSkills(agentId);
    void this.runtimeCache.set(key, skills, 60);
    return skills;
  }

  private async loadSkill(skillId: string) {
    const key = `skill:${skillId}`;
    const cached = await this.runtimeCache.get<Awaited<ReturnType<SkillsService['findById']>>>(key);
    if (cached) return cached;
    const skill = await this.skillsService.findById(skillId);
    void this.runtimeCache.set(key, skill, 300);
    return skill;
  }

  private executeSkill(
    step: import('../../planner/interfaces/plan.interface').PlanStep,
    skill: SkillContext | undefined,
    args: Record<string, unknown>,
    requestOrLegacyModel: ExecuteRequest | string,
    legacyRequest?: ExecuteRequest,
  ): Promise<unknown> {
    const request = legacyRequest ?? (requestOrLegacyModel as ExecuteRequest);
    return this.skillRuntime.execute(step, skill, args, request);
  }

  private async waitingRun(runId: string, response: string, plan: Plan): Promise<ExecuteResponse> {
    await this.runsService.transitionStatus(runId, 'WAITING');
    return {
      runId,
      status: 'WAITING',
      response,
      plan,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private async completeRun(
    runId: string,
    response: string,
    workflow?: WorkflowDefinition,
    conversationId?: string,
  ): Promise<ExecuteResponse> {
    const run = await this.runsService.complete(runId, response);
    return {
      runId: run.id,
      conversationId,
      status: 'COMPLETED',
      response,
      workflow,
      usage: {
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        totalTokens: run.totalTokens,
      },
    };
  }

  private async failRun(runId: string, error: string): Promise<ExecuteResponse> {
    await this.runsService.fail(runId, error);
    return {
      runId,
      status: 'FAILED',
      response: error,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
