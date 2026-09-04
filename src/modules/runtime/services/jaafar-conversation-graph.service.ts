import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import type { LLMExecutionMetadata } from '../../../infrastructure/llm-runtime/interfaces/llm-runtime.interface';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import { buildConversationSystemPrompt } from '../../../infrastructure/prompts/system-prompts';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import { runtimeUserErrorMessage } from '../shared/runtime-user-message';
import { stripThinkTags, ThinkTagFilter } from '../shared/think-tags';
import { RuntimeMode, type RuntimeRequest } from '../types/runtime.types';
import { ContextBuilderService } from './context-builder.service';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import type { ExecuteResponse } from './runtime.service';
import { RuntimeObservabilityService } from './runtime-observability.service';

export type ConversationGraphStreamEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'graph.node.started'; runId: string; node: string }
  | { type: 'graph.node.completed'; runId: string; node: string; durationMs: number }
  | { type: 'token'; runId: string; content: string }
  | {
      type: 'run.completed';
      runId: string;
      response: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | { type: 'run.failed'; runId: string; code: string; message: string };

interface ConversationGraphState {
  input: RuntimeRequest & { runId?: string };
  context?: Awaited<ReturnType<JaafarContextLoaderService['load']>>;
  response?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  execution?: LLMExecutionMetadata;
}

const ConversationGraphState = Annotation.Root({
  input: Annotation<RuntimeRequest & { runId?: string }>({
    default: () => ({ userMessage: '', agentId: '', mode: RuntimeMode.CONVERSATION }),
    reducer: (_left, right) => right,
  }),
  context: Annotation<ConversationGraphState['context']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  response: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  usage: Annotation<ConversationGraphState['usage']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  execution: Annotation<ConversationGraphState['execution']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
});

@Injectable()
export class JaafarConversationGraphService {
  private readonly memoryCheckpointer = new MemorySaver();

  private readonly logger = new Logger(JaafarConversationGraphService.name);

  constructor(
    private readonly runs: RunsService,
    private readonly conversations: ConversationsService,
    private readonly contextLoader: JaafarContextLoaderService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly llmRuntime: LLMRuntimeService,
    private readonly observability?: RuntimeObservabilityService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
  ) {}

  async run(request: RuntimeRequest): Promise<ExecuteResponse> {
    const run = await this.runs.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      metadata: { runtimeMode: 'conversation', intent: 'conversation' },
    });
    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      const input = { ...request, runId: run.id };
      const result = await this.build({ durable: true }).invoke(
        { input },
        this.graphConfig(run.id, input),
      );
      const completed = await this.runs.complete(run.id, result.response);
      return {
        runId: completed.id,
        conversationId: request.conversationId,
        mode: 'conversation',
        status: 'COMPLETED',
        response: stripThinkTags(result.response ?? ''),
        usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        execution: result.execution,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation graph failed';
      this.logger.error(`Conversation graph run ${run.id} failed: ${message}`);
      await this.runs.fail(run.id, message);
      return {
        runId: run.id,
        conversationId: request.conversationId,
        mode: 'conversation',
        status: 'FAILED',
        response: message,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  async *stream(request: RuntimeRequest): AsyncGenerator<ConversationGraphStreamEvent> {
    const run = await this.runs.create({
      agentId: request.agentId,
      conversationId: request.conversationId,
      userId: request.userId,
      organizationId: request.organizationId,
      metadata: { runtimeMode: RuntimeMode.CONVERSATION, transport: 'sse' },
    });
    yield { type: 'run.started', runId: run.id };
    const startedAt = Date.now();
    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      yield { type: 'graph.node.started', runId: run.id, node: 'load_context' };
      const loaded = await this.contextLoader.load({
        agentId: request.agentId,
        userMessage: request.userMessage,
        conversationId: request.conversationId,
        userId: request.userId,
        organizationId: request.organizationId,
        mode: 'conversation',
      });
      yield {
        type: 'graph.node.completed',
        runId: run.id,
        node: 'load_context',
        durationMs: Date.now() - startedAt,
      };
      const context = await this.contextBuilder.build({
        systemPrompt: buildConversationSystemPrompt({
          agentInstructions: loaded.agent.instructions,
        }),
        agentId: request.agentId,
        conversationId: request.conversationId,
        userId: request.userId,
        organizationId: request.organizationId,
        userMessage: request.userMessage,
        conversationHistory: loaded.history,
      });
      let response = '';
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const modelStartedAt = Date.now();
      let recordedFirstToken = false;
      const thinkFilter = new ThinkTagFilter();
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
      for await (const chunk of stream) {
        if (chunk.type === 'text' && chunk.content) {
          const safe = thinkFilter.push(chunk.content);
          if (!recordedFirstToken && safe) {
            this.observability?.recordFirstToken(Date.now() - modelStartedAt);
            recordedFirstToken = true;
          }
          response += safe;
          if (safe) {
            yield { type: 'token', runId: run.id, content: safe };
          }
        }
        if (chunk.type === 'finish') usage = chunk.usage ?? usage;
      }
      response += thinkFilter.flush();
      if (typeof this.runs.recordModelUsage === 'function') {
        await this.runs.recordModelUsage(run.id, usage);
      } else {
        await this.runs.updateUsage(run.id, usage);
      }
      await this.runs.updateMetadata(run.id, { intent: 'conversation', transport: 'sse' });
      if (request.conversationId) {
        await this.conversations.addMessage(request.conversationId, {
          role: 'user',
          content: request.userMessage,
        });
        await this.conversations.titleFromFirstMessage(request.conversationId, request.userMessage);
        await this.conversations.addMessage(request.conversationId, {
          role: 'assistant',
          content: response,
        });
      }
      await this.runs.complete(run.id, response);
      yield { type: 'run.completed', runId: run.id, response, usage };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation stream failed';
      await this.runs.fail(run.id, message);
      yield {
        type: 'run.failed',
        runId: run.id,
        code: 'CONVERSATION_FAILED',
        message: runtimeUserErrorMessage(error),
      };
    }
  }

  build(options: { durable?: boolean } = {}) {
    return new StateGraph(ConversationGraphState)
      .addNode('load_context', async (state) => ({
        context: await this.contextLoader.load({
          agentId: state.input.agentId,
          userMessage: state.input.userMessage,
          conversationId: state.input.conversationId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          mode: 'conversation',
        }),
      }))
      .addNode('generate_response', async (state) => {
        if (!state.context) throw new Error('Conversation context was not loaded');
        const context = await this.contextBuilder.build({
          systemPrompt: buildConversationSystemPrompt({
            agentInstructions: state.context.agent.instructions,
          }),
          agentId: state.input.agentId,
          conversationId: state.input.conversationId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          userMessage: state.input.userMessage,
          conversationHistory: state.context.history,
        });
        const result = await this.llmRuntime.generateText({
          mode: state.input.effort ?? 'medium',
          systemPrompt: context.system,
          messages: context.messages.map((message) => ({
            role: message.role as 'system' | 'user' | 'assistant',
            content: message.content,
          })),
          temperature: 0.7,
          maxTokens: 1200,
        });
        return {
          response: stripThinkTags(result.content),
          usage: result.usage,
          execution: result.execution,
        };
      })
      .addNode('persist_response', async (state) => {
        if (!state.response) throw new Error('Conversation response was not generated');
        if (state.input.runId) {
          await this.runs.updateMetadata(state.input.runId, {
            intent: 'conversation',
            execution: state.execution,
          });
          const usage = state.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
          if (typeof this.runs.recordModelUsage === 'function') {
            await this.runs.recordModelUsage(
              state.input.runId,
              usage,
              state.execution?.estimatedCost,
            );
          } else {
            await this.runs.updateUsage(state.input.runId, usage);
          }
        }
        if (state.input.conversationId) {
          await this.conversations.addMessage(state.input.conversationId, {
            role: 'user',
            content: state.input.userMessage,
          });
          await this.conversations.titleFromFirstMessage(
            state.input.conversationId,
            state.input.userMessage,
          );
          await this.conversations.addMessage(state.input.conversationId, {
            role: 'assistant',
            content: state.response,
          });
        }
        return {};
      })
      .addEdge(START, 'load_context')
      .addEdge('load_context', 'generate_response')
      .addEdge('generate_response', 'persist_response')
      .addEdge('persist_response', END)
      .compile(options.durable ? { checkpointer: this.checkpointer() } : undefined);
  }

  graphConfig(runId: string, scope: Pick<RuntimeRequest, 'userId' | 'organizationId'>) {
    return {
      configurable: {
        thread_id: `jaafar:conversation:${scope.organizationId ?? 'personal'}:${scope.userId ?? 'anonymous'}:${runId}`,
      },
    };
  }

  private checkpointer() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return this.memoryCheckpointer;
    if (this.postgresCheckpointer) return this.postgresCheckpointer.getCheckpointer();
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PostgreSQL checkpointing is required for production graph execution');
    }
    return this.memoryCheckpointer;
  }
}
