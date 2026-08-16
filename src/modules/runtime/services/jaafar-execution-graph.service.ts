import { Annotation, Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import type { HarnessUsage } from '../interfaces/harness.interface';
import type { ToolCall, ToolDefinition, ToolResult } from '../interfaces/tool.interface';
import type { JaafarModelCall } from '../types/jaafar-model.types';
import type { JaafarPlan } from '../types/jaafar-plan.types';
import { JaafarFinalResponseService } from './jaafar-final-response.service';
import { HarnessLimitError, JaafarHarnessService } from './jaafar-harness.service';
import { ToolExecutorService } from './tool-executor.service';

export interface JaafarExecutionGraphInput {
  runId: string;
  agentId: string;
  userMessage: string;
  tools: ToolDefinition[];
  plan: JaafarPlan;
  userId?: string;
  organizationId?: string;
  conversationId?: string;
  approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected';
}

export type ExecutionGraphStreamEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'graph.node.completed'; runId: string; node: string; durationMs: number }
  | {
      type: 'tool.started';
      runId: string;
      callId: string;
      toolName: string;
      args: ToolCall['input'];
    }
  | {
      type: 'tool.completed';
      runId: string;
      callId: string;
      toolName: string;
      durationMs: number;
      result?: ToolResult['output'];
    }
  | {
      type: 'tool.failed';
      runId: string;
      callId: string;
      toolName: string;
      error: NonNullable<ToolResult['error']>;
    }
  | { type: 'approval.required'; runId: string; reason: string }
  | { type: 'run.waiting'; runId: string; reason: 'approval' }
  | { type: 'run.completed'; runId: string; response: string; usage?: HarnessUsage }
  | { type: 'run.failed'; runId: string; message: string };

type ExecutionRoute = 'invoke' | 'retry' | 'waiting' | 'failed' | 'completed';

interface ExecutionState {
  input: JaafarExecutionGraphInput;
  stepIndex: number;
  toolCalls: ToolCall[];
  results: ToolResult[];
  retriesByTool: Record<string, number>;
  usage: HarnessUsage;
  currentCall?: ToolCall;
  route?: ExecutionRoute;
  error?: { code: string; message: string; retryable: boolean };
  response?: string;
  modelCalls: JaafarModelCall[];
}

const ExecutionGraphState = Annotation.Root({
  input: Annotation<JaafarExecutionGraphInput>({
    default: () => ({
      runId: '',
      agentId: '',
      userMessage: '',
      tools: [],
      plan: {
        schemaVersion: 1,
        goal: '',
        steps: [],
        successCriteria: [],
        requiresApproval: false,
      },
    }),
    reducer: (_left, right) => right,
  }),
  stepIndex: Annotation<number>({ default: () => 0, reducer: (_left, right) => right }),
  toolCalls: Annotation<ToolCall[]>({
    default: () => [],
    reducer: (left, right) => [...left, ...right],
  }),
  results: Annotation<ToolResult[]>({
    default: () => [],
    reducer: (left, right) => [...left, ...right],
  }),
  retriesByTool: Annotation<Record<string, number>>({
    default: () => ({}),
    reducer: (_left, right) => right,
  }),
  usage: Annotation<HarnessUsage>({
    default: () => ({ graphSteps: 0, toolCalls: 0, retriesByTool: {}, elapsedMs: 0 }),
    reducer: (_left, right) => right,
  }),
  currentCall: Annotation<ToolCall | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  route: Annotation<ExecutionRoute | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  error: Annotation<ExecutionState['error']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  response: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  modelCalls: Annotation<JaafarModelCall[]>({
    default: () => [],
    reducer: (left, right) => [...left, ...right],
  }),
});

@Injectable()
export class JaafarExecutionGraphService {
  constructor(
    private readonly executor: ToolExecutorService,
    private readonly harness: JaafarHarnessService,
    @Optional() private readonly finalResponse?: JaafarFinalResponseService,
    @Optional() private readonly conversations?: ConversationsService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
  ) {}

  private readonly memoryCheckpointer = new MemorySaver();

  build(options: { durable?: boolean } = {}) {
    return new StateGraph(ExecutionGraphState)
      .addNode('select_action', (state) => {
        const usage = { ...state.usage, graphSteps: state.usage.graphSteps + 1 };
        try {
          this.harness.assertWithinLimits(usage, Date.now());
          const step = state.input.plan.steps[state.stepIndex];
          if (!step) return { usage, route: 'completed' as const };
          const tool = state.input.tools.find(
            (candidate) =>
              candidate.id === step.toolId ||
              candidate.name === step.toolId ||
              candidate.slug === step.toolId,
          );
          if (!tool) {
            return {
              usage,
              route: 'failed' as const,
              error: {
                code: 'TOOL_NOT_FOUND',
                message: `Tool "${step.toolId}" is not available`,
                retryable: false,
              },
            };
          }
          const call: ToolCall = {
            callId: `${state.input.runId}:${tool.id}:${step.stepId}`,
            toolId: tool.id,
            toolName: tool.name,
            input: step.input,
          };
          return { usage, currentCall: call, toolCalls: [call], route: 'invoke' as const };
        } catch (error) {
          return {
            usage,
            route: 'failed' as const,
            error: this.runtimeError(error),
          };
        }
      })
      .addNode('invoke_tool', async (state) => {
        if (!state.currentCall) throw new Error('Tool action was not selected');
        const tool = state.input.tools.find(
          (candidate) => candidate.id === state.currentCall?.toolId,
        );
        if (!tool) throw new Error(`Tool "${state.currentCall.toolId}" is not available`);
        let approvalGranted = false;
        if (tool.requiresApproval || tool.sideEffect) {
          const decision = interrupt({
            type: 'tool_approval',
            runId: state.input.runId,
            callId: state.currentCall.callId,
            toolName: tool.name,
            reason: `Tool "${tool.name}" requires approval before execution.`,
          }) as { approved?: boolean } | undefined;
          if (!decision?.approved) {
            return {
              results: [
                {
                  callId: state.currentCall.callId,
                  toolId: tool.id,
                  success: false,
                  error: {
                    code: 'APPROVAL_REQUIRED',
                    message: `Tool "${tool.name}" requires approval before execution.`,
                    retryable: false,
                  },
                  durationMs: 0,
                },
              ],
              usage: state.usage,
            };
          }
          approvalGranted = true;
        }
        const usage = { ...state.usage, toolCalls: state.usage.toolCalls + 1 };
        try {
          this.harness.assertWithinLimits(usage, Date.now());
        } catch (error) {
          return {
            results: [
              {
                callId: state.currentCall.callId,
                toolId: tool.id,
                success: false,
                error: this.runtimeError(error),
                durationMs: 0,
              },
            ],
            usage,
          };
        }
        const result = await this.executor.execute(tool, {
          runId: state.input.runId,
          agentId: state.input.agentId,
          userMessage: state.input.userMessage,
          input: state.currentCall.input,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          approvalStatus: approvalGranted ? 'approved' : state.input.approvalStatus,
          logicalAction: state.currentCall.callId,
        });
        return {
          results: [result],
          usage,
        };
      })
      .addNode('observe_result', (state) => {
        const result = state.results[state.results.length - 1];
        if (!result)
          return {
            route: 'failed' as const,
            error: {
              code: 'UNKNOWN_RUNTIME_FAILURE',
              message: 'Tool result was not produced',
              retryable: false,
            },
          };
        if (result.success)
          return {
            stepIndex: state.stepIndex + 1,
            currentCall: undefined,
            route: 'invoke' as const,
          };
        if (result.error?.code === 'APPROVAL_REQUIRED') {
          return {
            route: 'waiting' as const,
            error: { code: 'APPROVAL_REQUIRED', message: result.error.message, retryable: false },
          };
        }
        const toolId = result.toolId;
        const retries = (state.retriesByTool[toolId] ?? 0) + 1;
        const nextRetries = { ...state.retriesByTool, [toolId]: retries };
        if (result.error?.retryable && retries <= this.harness.getPolicy().maxRetriesPerTool) {
          return {
            retriesByTool: nextRetries,
            usage: { ...state.usage, retriesByTool: nextRetries },
            route: 'retry' as const,
          };
        }
        return {
          retriesByTool: nextRetries,
          usage: { ...state.usage, retriesByTool: nextRetries },
          route: 'failed' as const,
          error: result.error ?? {
            code: 'UNKNOWN_RUNTIME_FAILURE',
            message: 'Tool execution failed',
            retryable: false,
          },
        };
      })
      .addNode('final_response', async (state) => {
        if (!this.finalResponse) return { route: 'completed' as const };
        const generated = await this.finalResponse.generate({
          userMessage: state.input.userMessage,
          results: state.results,
          error: state.error,
          effort: 'medium',
        });
        if (state.input.conversationId) {
          await this.conversations?.addMessage(state.input.conversationId, {
            role: 'user',
            content: state.input.userMessage,
          });
          await this.conversations?.titleFromFirstMessage(
            state.input.conversationId,
            state.input.userMessage,
          );
          await this.conversations?.addMessage(state.input.conversationId, {
            role: 'assistant',
            content: generated.response,
            metadata: { runId: state.input.runId, groundedInToolResults: true },
          });
        }
        return {
          response: generated.response,
          modelCalls: [generated.modelCall],
          route: 'completed' as const,
        };
      })
      .addEdge(START, 'select_action')
      .addConditionalEdges('select_action', (state) => state.route ?? 'failed', {
        invoke: 'invoke_tool',
        completed: 'final_response',
        failed: 'final_response',
      })
      .addEdge('invoke_tool', 'observe_result')
      .addConditionalEdges('observe_result', (state) => state.route ?? 'failed', {
        invoke: 'select_action',
        retry: 'invoke_tool',
        waiting: END,
        failed: 'final_response',
      })
      .addEdge('final_response', END)
      .compile(
        options.durable
          ? {
              checkpointer: this.durableCheckpointer(),
            }
          : undefined,
      );
  }

  private durableCheckpointer() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return this.memoryCheckpointer;
    if (this.postgresCheckpointer) return this.postgresCheckpointer.getCheckpointer();
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PostgreSQL checkpointing is required for production graph execution');
    }
    return this.memoryCheckpointer;
  }

  graphConfig(runId: string, scope?: Pick<JaafarExecutionGraphInput, 'userId' | 'organizationId'>) {
    return {
      configurable: {
        thread_id: `jaafar:execution:${scope?.organizationId ?? 'personal'}:${scope?.userId ?? 'anonymous'}:${runId}`,
      },
    };
  }

  resume(
    runId: string,
    approved: boolean,
    scope?: Pick<JaafarExecutionGraphInput, 'userId' | 'organizationId'>,
  ) {
    return this.build({ durable: true }).invoke(
      new Command({ resume: { approved } }),
      this.graphConfig(runId, scope),
    );
  }

  async *stream(input: JaafarExecutionGraphInput): AsyncGenerator<ExecutionGraphStreamEvent> {
    yield { type: 'run.started', runId: input.runId };
    try {
      const updates = await this.build({ durable: true }).stream(
        { input },
        { ...this.graphConfig(input.runId, input), streamMode: 'updates' },
      );
      for await (const update of updates) {
        const nodeStartedAt = Date.now();
        const entries = Object.entries(update as Record<string, unknown>);
        for (const [node, value] of entries) {
          const state = (value ?? {}) as Partial<ExecutionState> & { __interrupt__?: unknown };
          if (node === 'invoke_tool' && state.results?.length) {
            const result = state.results[state.results.length - 1];
            const tool = input.tools.find((candidate) => candidate.id === result.toolId);
            if (result.success) {
              yield {
                type: 'tool.completed',
                runId: input.runId,
                callId: result.callId,
                toolName: tool?.name ?? result.toolId,
                durationMs: result.durationMs,
                result: result.output,
              };
            } else if (result.error) {
              yield {
                type: 'tool.failed',
                runId: input.runId,
                callId: result.callId,
                toolName: tool?.name ?? result.toolId,
                error: result.error,
              };
            }
          }
          if (node === 'select_action' && state.currentCall) {
            yield {
              type: 'tool.started',
              runId: input.runId,
              callId: state.currentCall.callId,
              toolName: state.currentCall.toolName,
              args: state.currentCall.input,
            };
          }
          if (node === 'invoke_tool' && state.__interrupt__) {
            const interruptValue = state.__interrupt__ as { value?: { reason?: string } };
            const reason =
              interruptValue.value?.reason ?? 'Approval is required before continuing.';
            yield { type: 'approval.required', runId: input.runId, reason };
            yield { type: 'run.waiting', runId: input.runId, reason: 'approval' };
            return;
          }
          if (node === 'final_response') {
            yield {
              type: 'run.completed',
              runId: input.runId,
              response: state.response ?? '',
              usage: state.usage,
            };
          }
          yield {
            type: 'graph.node.completed',
            runId: input.runId,
            node,
            durationMs: Date.now() - nodeStartedAt,
          };
        }
      }
    } catch (error) {
      yield {
        type: 'run.failed',
        runId: input.runId,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private runtimeError(error: unknown) {
    if (error instanceof HarnessLimitError) {
      return { code: error.code, message: error.message, retryable: false };
    }
    return {
      code: 'UNKNOWN_RUNTIME_FAILURE',
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
}
