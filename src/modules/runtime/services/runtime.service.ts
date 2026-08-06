import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToolSet } from 'ai';
import { jsonSchema, tool } from 'ai';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { KnowledgeService } from '../../knowledge/services/knowledge.service';
import { MemoryService } from '../../memory/services/memory.service';
import { type Plan, type PlanStep } from '../../planner/interfaces/plan.interface';
import { PlannerService } from '../../planner/planner.service';
import { RunsService } from '../../runs/runs.service';
import { SKILL_EXECUTION_MODE } from '../../skills/constants/skill.constants';
import { SkillsService } from '../../skills/services/skills.service';
import { generateWorkflow, type WorkflowDefinition } from '../types/workflow.types';
import { ContextBuilderService } from './context-builder.service';

export interface ExecuteRequest {
  userMessage: string;
  agentId: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
}

export interface ExecuteResponse {
  runId: string;
  response: string;
  status?: string;
  plan?: unknown;
  workflow?: WorkflowDefinition;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface SkillContext {
  id: string;
  skillId: string;
  name: string;
  slug: string;
  description?: string;
  executionMode: string;
  instructions?: string;
  timeout?: number;
  retryPolicy?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

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
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
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

      const agent = await this.agentsService.findById(request.agentId, true);

      await this.runsService.transitionStatus(run.id, 'PLANNING');

      const agentSkills = await this.agentsService.getSkills(request.agentId);
      const availableSkills = (
        await Promise.all(
          agentSkills
            .filter((s) => s.enabled)
            .map(async (s) => {
              try {
                const skill = await this.skillsService.findById(s.skillId);
                return {
                  id: s.id,
                  skillId: s.skillId,
                  name: skill.name,
                  slug: skill.slug,
                  description: skill.description ?? undefined,
                  executionMode: skill.executionMode,
                  instructions: skill.instructions ?? undefined,
                  timeout: skill.timeout ?? undefined,
                  inputSchema: (skill.inputSchema as Record<string, unknown> | null) ?? undefined,
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
        organizationId: request.organizationId,
        availableSkills,
        conversationHistory,
      });

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
        const missingMsg = plan.missingInputs.map((m) => `- ${m.description}`).join('\n');
        return this.waitingRun(run.id, `I need more information:\n${missingMsg}`, plan);
      }

      return this.waitingRun(run.id, 'The execution plan is ready for your approval.', plan);
    } catch (error) {
      return this.handleFailure(run.id, error);
    }
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
      const agent = await this.agentsService.findById(request.agentId, true);
      const agentSkills = await this.agentsService.getSkills(request.agentId);
      const availableSkills = (
        await Promise.all(
          agentSkills
            .filter((s) => s.enabled)
            .map(async (s) => {
              try {
                const skill = await this.skillsService.findById(s.skillId);
                return {
                  id: s.id,
                  skillId: s.skillId,
                  name: skill.name,
                  slug: skill.slug,
                  description: skill.description ?? undefined,
                  executionMode: skill.executionMode,
                  instructions: skill.instructions ?? undefined,
                  timeout: skill.timeout ?? undefined,
                  inputSchema: (skill.inputSchema as Record<string, unknown> | null) ?? undefined,
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
        systemPrompt: 'You are a helpful AI employee.',
        agentInstructions: agent.instructions ?? undefined,
        agentId: request.agentId,
        conversationId: request.conversationId,
        organizationId: request.organizationId,
        userMessage: request.userMessage,
        conversationHistory,
        skillInstructions:
          plan.steps.length > 0
            ? `I have the following plan:\n${plan.goal}\n\nSteps:\n${plan.steps.map((s) => `${s.order}. ${s.skillName}`).join('\n')}`
            : undefined,
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

      return this.completeRun(runId, result.content, workflow);
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

  private async executeSkill(
    step: PlanStep,
    skill: SkillContext | undefined,
    args: Record<string, unknown>,
    requestOrLegacyModel: ExecuteRequest | string,
    legacyRequest?: ExecuteRequest,
  ): Promise<unknown> {
    const request = legacyRequest ?? (requestOrLegacyModel as ExecuteRequest);
    if (!skill) {
      throw new Error(`Skill "${step.skillName}" is not available for this agent`);
    }

    const timeoutMs = skill.timeout ?? 60_000;
    const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Skill "${skill.name}" timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);

    const query = this.resolveQuery(args, step, request);

    switch (skill.executionMode) {
      case SKILL_EXECUTION_MODE.KNOWLEDGE_RETRIEVAL: {
        return withTimeout(
          this.knowledgeService.search({
            organizationId: request.organizationId,
            query,
            limit: this.toNumber(args.limit, 5),
            offset: 0,
          }),
        );
      }

      case SKILL_EXECUTION_MODE.MEMORY_RETRIEVAL: {
        return withTimeout(
          this.memoryService.searchByAgent(request.agentId, query, {
            limit: this.toNumber(args.limit, 10),
          }),
        );
      }

      case SKILL_EXECUTION_MODE.N8N_WORKFLOW: {
        return withTimeout(this.runN8nWorkflow(skill, args, request));
      }

      case SKILL_EXECUTION_MODE.HUMAN_APPROVAL: {
        throw new Error(
          `Skill "${skill.name}" requires human approval and cannot run autonomously`,
        );
      }

      default: {
        return withTimeout(this.runAiSkill(skill, step, args, query, request));
      }
    }
  }

  private async runAiSkill(
    skill: SkillContext,
    step: PlanStep,
    args: Record<string, unknown>,
    query: string,
    request: ExecuteRequest,
  ): Promise<string> {
    let knowledgeContext = '';
    if (skill.executionMode === SKILL_EXECUTION_MODE.HYBRID) {
      const chunks = await this.knowledgeService.search({
        organizationId: request.organizationId,
        query,
        limit: 3,
        offset: 0,
      });
      knowledgeContext =
        chunks.length > 0
          ? `\n\nRelevant knowledge:\n${chunks.map((chunk) => chunk.content).join('\n---\n')}`
          : '\n\n(No relevant knowledge found.)';
    }

    const result = await this.llmRuntime.generateText({
      mode: 'medium',
      systemPrompt: `${
        skill.instructions ?? `You are the "${skill.name}" skill.`
      }${knowledgeContext}`,
      messages: [
        {
          role: 'user',
          content: `Skill input:\n${this.serialize(args)}\n\nPlan input:\n${this.serialize(step.input)}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 1500,
    });

    return result.content;
  }

  private async runN8nWorkflow(
    skill: SkillContext,
    args: Record<string, unknown>,
    request: ExecuteRequest,
  ): Promise<unknown> {
    const webhookBase = this.configService.get<string>('N8N_WEBHOOK_URL');
    if (!webhookBase) {
      throw new Error('N8N_WEBHOOK_URL is not configured');
    }

    const url = `${webhookBase.replace(/\/+$/, '')}/${skill.slug}`;
    const retryPolicy = (skill.retryPolicy ?? {}) as { maxAttempts?: number };
    const maxAttempts = Math.max(1, this.toNumber(retryPolicy.maxAttempts, 1));
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...args,
            userId: request.userId,
            organizationId: request.organizationId,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? '';
          return contentType.includes('application/json') ? response.json() : response.text();
        }

        lastError = new Error(`n8n workflow returned HTTP ${response.status}`);
        if (response.status < 500) break;
      } catch (error) {
        lastError = error;
      }

      this.logger.warn(`n8n workflow "${skill.slug}" attempt ${attempt}/${maxAttempts} failed`);
    }

    throw lastError instanceof Error ? lastError : new Error('n8n workflow failed');
  }

  private resolveQuery(
    args: Record<string, unknown>,
    step: PlanStep,
    request: ExecuteRequest,
  ): string {
    const candidate = args.query ?? args.text ?? args.prompt ?? step.input.query ?? step.input.text;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
    return request.userMessage;
  }

  private serialize(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private toNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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
  ): Promise<ExecuteResponse> {
    const run = await this.runsService.complete(runId, response);
    return {
      runId: run.id,
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
