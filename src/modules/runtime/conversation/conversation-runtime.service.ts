import { Injectable, Logger } from '@nestjs/common';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { buildConversationSystemPrompt } from '../../../infrastructure/prompts/system-prompts';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import { ContextBuilderService } from '../services/context-builder.service';
import type { ExecuteResponse } from '../services/runtime.service';
import { RuntimeCacheService } from '../shared/runtime-cache.service';
import { runtimeUserErrorMessage } from '../shared/runtime-user-message';
import type { RuntimeRequest } from '../types/runtime.types';

export type ConversationStreamEvent =
  | { type: 'run.started'; runId: string; mode: RuntimeRequest['mode']; conversationId?: string }
  | { type: 'token'; runId: string; content: string }
  | {
      type: 'run.completed';
      runId: string;
      conversationId?: string;
      response: string;
      usage: ExecuteResponse['usage'];
    }
  | { type: 'run.failed'; runId: string; code: string; message: string };

@Injectable()
export class ConversationRuntimeService {
  private readonly logger = new Logger(ConversationRuntimeService.name);

  constructor(
    private readonly runsService: RunsService,
    private readonly agentsService: AgentsService,
    private readonly conversationsService: ConversationsService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly llmRuntime: LLMRuntimeService,
    private readonly runtimeCache: RuntimeCacheService,
  ) {}

  async run(request: RuntimeRequest): Promise<ExecuteResponse> {
    const run = await this.runsService.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      metadata: { runtimeMode: request.mode },
    });

    try {
      await this.runsService.transitionStatus(run.id, 'PREPARING');
      const [agent, messages] = await Promise.all([
        this.loadAgent(request.agentId, {
          userId: request.userId,
          organizationId: request.organizationId,
        }),
        request.conversationId
          ? this.conversationsService.getMessages(request.conversationId, { take: 20 })
          : Promise.resolve([]),
      ]);
      const organizationId = request.organizationId ?? agent.organizationId ?? undefined;
      const userId = request.userId ?? agent.userId ?? undefined;
      const conversationHistory = messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const context = await this.contextBuilder.build({
        systemPrompt: buildConversationSystemPrompt({
          agentInstructions: agent.instructions ?? undefined,
        }),
        agentId: request.agentId,
        conversationId: request.conversationId,
        userId,
        organizationId,
        userMessage: request.userMessage,
        conversationHistory,
      });
      const result = await this.llmRuntime.generateText({
        mode: request.effort ?? 'medium',
        timeoutMs: 20_000,
        systemPrompt: context.system,
        messages: context.messages.map((message) => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content: message.content,
        })),
        temperature: 0.7,
        maxTokens: 1200,
      });

      await this.runsService.updateUsage(run.id, result.usage);
      await this.runsService.updateMetadata(run.id, {
        intent: 'conversation',
        execution: result.execution,
      });

      if (request.conversationId) {
        await this.conversationsService.addMessage(request.conversationId, {
          role: 'user',
          content: request.userMessage,
        });
        await this.conversationsService.titleFromFirstMessage(
          request.conversationId,
          request.userMessage,
        );
        await this.conversationsService.addMessage(request.conversationId, {
          role: 'assistant',
          content: result.content,
        });
      }

      const completed = await this.runsService.complete(run.id, result.content);
      return {
        runId: completed.id,
        conversationId: request.conversationId,
        mode: request.mode,
        status: 'COMPLETED',
        response: result.content,
        usage: {
          promptTokens: completed.promptTokens,
          completionTokens: completed.completionTokens,
          totalTokens: completed.totalTokens,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Conversation run ${run.id} failed: ${message}`);
      await this.runsService.fail(run.id, message);
      return {
        runId: run.id,
        mode: request.mode,
        status: 'FAILED',
        response: runtimeUserErrorMessage(error),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  async *stream(request: RuntimeRequest): AsyncGenerator<ConversationStreamEvent> {
    const run = await this.runsService.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      metadata: { runtimeMode: request.mode, transport: 'sse' },
    });

    yield {
      type: 'run.started',
      runId: run.id,
      mode: request.mode,
      conversationId: request.conversationId,
    };

    try {
      await this.runsService.transitionStatus(run.id, 'PREPARING');
      const [agent, messages] = await Promise.all([
        this.loadAgent(request.agentId, {
          userId: request.userId,
          organizationId: request.organizationId,
        }),
        request.conversationId
          ? this.conversationsService.getMessages(request.conversationId, { take: 20 })
          : Promise.resolve([]),
      ]);
      const organizationId = request.organizationId ?? agent.organizationId ?? undefined;
      const userId = request.userId ?? agent.userId ?? undefined;
      const context = await this.contextBuilder.build({
        systemPrompt: buildConversationSystemPrompt({
          agentInstructions: agent.instructions ?? undefined,
        }),
        agentId: request.agentId,
        conversationId: request.conversationId,
        userId,
        organizationId,
        userMessage: request.userMessage,
        conversationHistory: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      const stream = this.llmRuntime.generateStream({
        mode: request.effort ?? 'medium',
        timeoutMs: 20_000,
        systemPrompt: context.system,
        messages: context.messages.map((message) => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content: message.content,
        })),
        temperature: 0.7,
        maxTokens: 1200,
      });
      let response = '';
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          response += chunk.content;
          yield { type: 'token', runId: run.id, content: chunk.content };
        }
        if (chunk.type === 'finish') {
          usage = chunk.usage ?? usage;
        }
      }

      const completed = await this.runsService.complete(run.id, response);
      void this.persistCompletedConversation(request, run.id, response, usage);
      yield {
        type: 'run.completed',
        runId: completed.id,
        conversationId: request.conversationId,
        response,
        usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.runsService.fail(run.id, message);
      yield {
        type: 'run.failed',
        runId: run.id,
        code: 'CONVERSATION_FAILED',
        message: runtimeUserErrorMessage(error),
      };
    }
  }

  private async loadAgent(agentId: string, scope?: { userId?: string; organizationId?: string }) {
    const key = `agent:profile:${agentId}:${scope?.userId ?? ''}:${scope?.organizationId ?? ''}`;
    const cached = await this.runtimeCache.get<Awaited<ReturnType<AgentsService['findById']>>>(key);
    if (cached) return cached;
    const agent = await this.agentsService.findById(agentId, false, scope);
    void this.runtimeCache.set(key, agent, 60);
    return agent;
  }

  private async persistCompletedConversation(
    request: RuntimeRequest,
    runId: string,
    response: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): Promise<void> {
    try {
      await Promise.all([
        this.runsService.updateUsage(runId, usage),
        this.runsService.updateMetadata(runId, { intent: 'conversation', transport: 'sse' }),
        request.conversationId
          ? this.persistMessagesAndTitle(request.conversationId, request.userMessage, response)
          : Promise.resolve(),
      ]);
    } catch (_error) {
      this.logger.warn(`Non-critical conversation persistence failed for run ${runId}`);
    }
  }

  private async persistMessagesAndTitle(
    conversationId: string,
    userMessage: string,
    response: string,
  ): Promise<void> {
    await this.conversationsService.addMessage(conversationId, {
      role: 'user',
      content: userMessage,
    });
    await this.conversationsService.titleFromFirstMessage(conversationId, userMessage);
    await this.conversationsService.addMessage(conversationId, {
      role: 'assistant',
      content: response,
    });
  }
}
