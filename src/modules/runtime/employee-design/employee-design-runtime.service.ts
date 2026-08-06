import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { BLUEPRINT_GENERATOR_SYSTEM_PROMPT } from '../../../infrastructure/prompts/system-prompts';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import { ContextBuilderService } from '../services/context-builder.service';
import type { ExecuteResponse } from '../services/runtime.service';
import type { RuntimeRequest } from '../types/runtime.types';

const blueprintSchema = z.object({
  name: z.string(),
  role: z.string(),
  department: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  goals: z.array(z.string()),
  knowledgeRequirements: z.array(z.string()),
  requiredTools: z.array(z.string()),
  requiredIntegrations: z.array(z.string()),
  channels: z.array(z.string()),
  memoryPolicy: z.string(),
  permissions: z.array(z.string()),
  workflow: z.array(z.string()),
});

type EmployeeBlueprint = z.infer<typeof blueprintSchema>;

@Injectable()
export class EmployeeDesignRuntimeService {
  private readonly logger = new Logger(EmployeeDesignRuntimeService.name);

  constructor(
    private readonly runsService: RunsService,
    private readonly agentsService: AgentsService,
    private readonly conversationsService: ConversationsService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly llmRuntime: LLMRuntimeService,
  ) {}

  async run(request: RuntimeRequest): Promise<ExecuteResponse> {
    const run = await this.runsService.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      metadata: { runtimeMode: request.mode, designStatus: 'DRAFT' },
    });

    try {
      await this.runsService.transitionStatus(run.id, 'PREPARING');
      const agent = await this.agentsService.findById(request.agentId);
      const history = request.conversationId
        ? (await this.conversationsService.getMessages(request.conversationId, { take: 20 })).map(
            (message) => ({ role: message.role, content: message.content }),
          )
        : [];
      const context = await this.contextBuilder.build({
        systemPrompt: `${BLUEPRINT_GENERATOR_SYSTEM_PROMPT}\n\nEmployee policies:\n${agent.instructions ?? ''}`,
        agentId: request.agentId,
        conversationId: request.conversationId,
        organizationId: request.organizationId,
        userMessage: request.userMessage,
        conversationHistory: history,
      });
      const result = await this.llmRuntime.generateObject({
        mode: request.effort ?? 'medium',
        systemPrompt: context.system,
        messages: context.messages.map((message) => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content: message.content,
        })),
        schema: blueprintSchema,
        temperature: 0.2,
        maxTokens: 2000,
      });
      const blueprint = blueprintSchema.parse(result.object);

      await this.runsService.updateUsage(run.id, result.usage);
      await this.runsService.updateMetadata(run.id, {
        blueprint,
        designStatus: 'DRAFT',
        execution: result.execution,
      });
      const response = this.formatSummary(blueprint);
      const completed = await this.runsService.complete(run.id, response);

      return {
        runId: completed.id,
        mode: request.mode,
        status: 'COMPLETED',
        response,
        plan: blueprint,
        usage: {
          promptTokens: completed.promptTokens,
          completionTokens: completed.completionTokens,
          totalTokens: completed.totalTokens,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Employee design run ${run.id} failed: ${message}`);
      await this.runsService.fail(run.id, message);
      return {
        runId: run.id,
        mode: request.mode,
        status: 'FAILED',
        response: `An error occurred: ${message}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  private formatSummary(blueprint: EmployeeBlueprint): string {
    return (
      `Draft employee blueprint: ${blueprint.name}\n\n${blueprint.summary}\n\n` +
      `Responsibilities:\n${blueprint.responsibilities.map((item) => `- ${item}`).join('\n')}`
    );
  }
}
