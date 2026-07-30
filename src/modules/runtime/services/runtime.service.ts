import { Injectable } from '@nestjs/common';
import type { AIAdapterService } from '../../../infrastructure/ai-adapter/ai-adapter.service';
import type { AgentsService } from '../../agents/services/agents.service';
import type { ConversationsService } from '../../conversations/services/conversations.service';
import type { MemoryService } from '../../memory/services/memory.service';
import type { PlannerService } from '../../planner/planner.service';
import type { RunsService } from '../../runs/runs.service';
import type { SkillsService } from '../../skills/services/skills.service';
import type { ContextBuilderService } from './context-builder.service';
import type { ToolRegistryService } from './tool-registry.service';

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
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

@Injectable()
export class RuntimeService {
  constructor(
    private readonly runsService: RunsService,
    private readonly agentsService: AgentsService,
    private readonly plannerService: PlannerService,
    private readonly aiAdapter: AIAdapterService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly conversationsService: ConversationsService,
    private readonly memoryService: MemoryService,
    private readonly skillsService: SkillsService,
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
      const skillDetails = await Promise.all(
        agentSkills
          .filter((s) => s.enabled)
          .map(async (s) => {
            try {
              const skill = await this.skillsService.findById(s.skillId);
              return {
                id: s.id,
                skillId: s.skillId,
                name: skill.name,
                description: skill.description ?? undefined,
                category: skill.category ?? undefined,
                executionMode: skill.executionMode,
                inputSchema: skill.inputSchema as Record<string, unknown> | undefined,
              };
            } catch {
              return null;
            }
          }),
      );
      const availableSkills = skillDetails.filter(Boolean) as Array<{
        id: string;
        skillId: string;
        name: string;
        description?: string;
        category?: string;
        executionMode: string;
        inputSchema?: Record<string, unknown>;
      }>;

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

      if (plan.missingInputs && plan.missingInputs.length > 0) {
        const missingMsg = plan.missingInputs.map((m) => `- ${m.description}`).join('\n');
        return this.completeRun(run.id, `I need more information:\n${missingMsg}`);
      }

      await this.runsService.transitionStatus(run.id, 'EXECUTING');

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

      for (const step of plan.steps) {
        this.toolRegistry.register(
          step.skillName,
          {
            name: step.skillName,
            description: `Execute ${step.skillName} skill`,
            parameters: step.input as Record<string, unknown>,
          },
          async (args) => {
            return {
              success: true,
              output: `Executed ${step.skillName} with ${JSON.stringify(args)}`,
            };
          },
        );
      }

      const result = await this.aiAdapter.generateText({
        model: agent.model || 'gpt-4o',
        systemPrompt: context.system,
        messages: context.messages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        temperature: 0.7,
        maxTokens: 2000,
      });

      await this.runsService.updateUsage(run.id, result.usage);

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

      this.toolRegistry.clear();

      return this.completeRun(run.id, result.content);
    } catch (error) {
      this.toolRegistry.clear();
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.runsService.fail(run.id, message);
      return {
        runId: run.id,
        response: `An error occurred: ${message}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  private async completeRun(runId: string, response: string): Promise<ExecuteResponse> {
    const run = await this.runsService.complete(runId, response);
    return {
      runId: run.id,
      response,
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
      response: error,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
