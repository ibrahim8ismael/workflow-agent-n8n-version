import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import type { JaafarModelCall } from '../types/jaafar-model.types';
import type { JaafarPlan } from '../types/jaafar-plan.types';
import { RuntimeMode, type RuntimeRequest } from '../types/runtime.types';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import { JaafarUnderstandingGraphService } from './jaafar-understanding-graph.service';

export type JaafarGraphRoute =
  | 'conversation'
  | 'automation_design'
  | 'task_execution'
  | 'general_question'
  | 'clarification';

export interface JaafarGraphInput extends RuntimeRequest {
  runId?: string;
}

export interface JaafarGraphOutput {
  input: JaafarGraphInput;
  route?: JaafarGraphRoute;
  understanding?: {
    route: JaafarGraphRoute;
    intent: 'conversation' | 'automation_design' | 'task_execution' | 'general_question';
    goal: string;
    businessContext: string;
    requirements: string[];
    missingInputs: string[];
    confidence: number;
    structured?: unknown;
    clarificationRequired: boolean;
    clarificationQuestion?: string;
  };
  context?: {
    skills: Array<{
      id: string;
      name: string;
      slug: string;
      description: string;
      executionMode: string;
      inputSchema: Record<string, unknown>;
      outputSchema: Record<string, unknown>;
      requiredPermissions: string[];
      requiredIntegrations: string[];
      requiresApproval: boolean;
      sideEffect: boolean;
      timeoutMs: number;
      maxRetries: number;
      retryPolicy: { maxAttempts: number; retryableCodes: string[] };
      idempotent: boolean;
      successCriteria: string[];
      permissionScope: string;
    }>;
    memoryReferences: string[];
    knowledgeReferences: string[];
    integrationReferences: string[];
  };
  plan?: JaafarPlan;
  modelCalls: JaafarModelCall[];
}

const JaafarGraphState = Annotation.Root({
  schemaVersion: Annotation<number>({ default: () => 1, reducer: (_left, right) => right }),
  run: Annotation<{
    runId: string;
    agentId: string;
    userId?: string;
    organizationId?: string;
    conversationId?: string;
    status: string;
  }>({
    default: () => ({ runId: '', agentId: '', status: 'CREATED' }),
    reducer: (_left, right) => right,
  }),
  request: Annotation<{
    userMessage: string;
    effort: 'low' | 'medium' | 'high';
    receivedAt: string;
    mode: RuntimeMode;
  }>({
    default: () => ({
      userMessage: '',
      effort: 'medium',
      receivedAt: '',
      mode: RuntimeMode.CONVERSATION,
    }),
    reducer: (_left, right) => right,
  }),
  conversation: Annotation<{
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    response?: string;
  }>({
    default: () => ({ history: [] }),
    reducer: (_left, right) => right,
  }),
  understanding: Annotation<{
    route?: JaafarGraphRoute;
    intent?: 'conversation' | 'automation_design' | 'task_execution' | 'general_question';
    goal?: string;
    businessContext?: string;
    requirements: string[];
    missingInputs: string[];
    confidence?: number;
    structured?: unknown;
    clarificationRequired?: boolean;
    clarificationQuestion?: string;
  }>({
    default: () => ({ requirements: [], missingInputs: [] }),
    reducer: (_left, right) => right,
  }),
  context: Annotation<{
    skills: Array<{
      id: string;
      name: string;
      slug: string;
      description: string;
      executionMode: string;
      inputSchema: Record<string, unknown>;
      outputSchema: Record<string, unknown>;
      requiredPermissions: string[];
      requiredIntegrations: string[];
      requiresApproval: boolean;
      sideEffect: boolean;
      timeoutMs: number;
      maxRetries: number;
      retryPolicy: { maxAttempts: number; retryableCodes: string[] };
      idempotent: boolean;
      successCriteria: string[];
      permissionScope: string;
    }>;
    memoryReferences: string[];
    knowledgeReferences: string[];
    integrationReferences: string[];
  }>({
    default: () => ({
      skills: [],
      memoryReferences: [],
      knowledgeReferences: [],
      integrationReferences: [],
    }),
    reducer: (_left, right) => right,
  }),
  modelCalls: Annotation<JaafarModelCall[]>({
    default: () => [],
    reducer: (left, right) => [...left, ...right],
  }),
  plan: Annotation<JaafarPlan | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  approval: Annotation<{
    status: 'not_required' | 'pending' | 'approved' | 'rejected';
    reason?: string;
    requestedAt?: string;
    resolvedAt?: string;
  }>({
    default: () => ({ status: 'not_required' }),
    reducer: (_left, right) => right,
  }),
  execution: Annotation<{
    stepIndex: number;
    toolCalls: Array<{
      callId: string;
      toolId: string;
      toolName: string;
      input: Record<string, unknown>;
      idempotencyKey?: string;
    }>;
    results: Array<{
      callId: string;
      toolId: string;
      success: boolean;
      output?: Record<string, unknown>;
      error?: { code: string; message: string; retryable: boolean };
      durationMs: number;
    }>;
    completed: boolean;
  }>({
    default: () => ({ stepIndex: 0, toolCalls: [], results: [], completed: false }),
    reducer: (_left, right) => right,
  }),
  reflection: Annotation<
    | {
        outcome?: 'success' | 'partial' | 'failed';
        summary?: string;
        learningCandidates?: string[];
      }
    | undefined
  >({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  errors: Annotation<Array<{ code: string; message: string; retryable: boolean }>>({
    default: () => [],
    reducer: (left, right) => [...left, ...right],
  }),
  route: Annotation<JaafarGraphRoute | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
});

@Injectable()
export class JaafarGraphService {
  private readonly memoryCheckpointer = new MemorySaver();

  constructor(
    private readonly understandingGraph: JaafarUnderstandingGraphService,
    private readonly contextLoader: JaafarContextLoaderService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
  ) {}

  build(options: { durable?: boolean } = {}) {
    return new StateGraph(JaafarGraphState)
      .addNode('load_context', async (state: typeof JaafarGraphState.State) => {
        const loaded = await this.contextLoader.load({
          agentId: state.run.agentId,
          userMessage: state.request.userMessage,
          conversationId: state.run.conversationId,
          userId: state.run.userId,
          organizationId: state.run.organizationId,
          mode: state.request.mode,
        });
        return {
          context: {
            skills: loaded.tools,
            memoryReferences: loaded.memoryReferences,
            knowledgeReferences: loaded.knowledgeReferences,
            integrationReferences: loaded.readiness,
          },
          conversation: { history: loaded.history },
        };
      })
      .addNode('understand_request', async (state: typeof JaafarGraphState.State) => {
        if (state.request.mode === RuntimeMode.AUTOMATION_DESIGN) {
          return {
            route: 'automation_design' as const,
            understanding: { route: 'automation_design' },
          };
        }
        const result = await this.understandingGraph.build({ durable: options.durable }).invoke(
          {
            input: {
              runId: state.run.runId,
              agentId: state.run.agentId,
              userMessage: state.request.userMessage,
              conversationId: state.run.conversationId,
              userId: state.run.userId,
              organizationId: state.run.organizationId,
              effort: state.request.effort,
            },
          },
          state.run.runId
            ? this.understandingGraph.graphConfig(state.run.runId, {
                userId: state.run.userId,
                organizationId: state.run.organizationId,
              })
            : undefined,
        );

        const u = result.understanding;
        return {
          route: (u?.route ?? 'clarification') as JaafarGraphRoute,
          understanding: u
            ? {
                route: u.route,
                intent: u.intent,
                goal: u.goal,
                businessContext: u.businessContext,
                requirements: u.requirements.map((r) => r.field),
                missingInputs: u.missingInputs.map((m) => m.field),
                confidence: u.confidence,
                structured: u,
                clarificationRequired: u.clarificationRequired,
                clarificationQuestion: u.clarificationQuestion,
              }
            : undefined,
          context: result.context,
          plan: result.plan,
          modelCalls: result.modelCalls ?? [],
        };
      })
      .addNode('plan_task', async (state: typeof JaafarGraphState.State) => {
        if (!state.context || !state.understanding) {
          throw new Error('Planning requires loaded context and understanding');
        }
        const planningResult = await this.understandingGraph
          .build({ durable: options.durable })
          .invoke(
            {
              input: {
                runId: state.run.runId,
                agentId: state.run.agentId,
                userMessage: state.request.userMessage,
                conversationId: state.run.conversationId,
                userId: state.run.userId,
                organizationId: state.run.organizationId,
                effort: state.request.effort,
              },
            },
            state.run.runId
              ? this.understandingGraph.graphConfig(state.run.runId, {
                  userId: state.run.userId,
                  organizationId: state.run.organizationId,
                })
              : undefined,
          );

        return { plan: planningResult.plan, modelCalls: planningResult.modelCalls ?? [] };
      })
      .addEdge(START, 'load_context')
      .addEdge('load_context', 'understand_request')
      .addConditionalEdges(
        'understand_request',
        (state: typeof JaafarGraphState.State) => state.route ?? 'clarification',
        {
          clarification: END,
          conversation: END,
          automation_design: END,
          task_execution: 'plan_task',
          general_question: END,
        },
      )
      .addEdge('plan_task', END)
      .compile(options.durable ? { checkpointer: this.checkpointer() } : undefined);
  }

  async classify(input: JaafarGraphInput): Promise<JaafarGraphOutput> {
    const result = await this.build({ durable: Boolean(input.runId) }).invoke(
      {
        run: {
          runId: input.runId ?? '',
          agentId: input.agentId,
          userId: input.userId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          status: 'PLANNING',
        },
        request: {
          userMessage: input.userMessage,
          effort: input.effort ?? 'medium',
          receivedAt: new Date().toISOString(),
          mode: input.mode ?? RuntimeMode.CONVERSATION,
        },
      },
      input.runId ? this.graphConfig(input.runId, input) : undefined,
    );
    return {
      input,
      route: result.route,
      understanding: result.understanding,
      context: result.context,
      plan: result.plan,
      modelCalls: result.modelCalls ?? [],
    } as JaafarGraphOutput;
  }

  graphConfig(runId: string, scope?: Pick<JaafarGraphInput, 'userId' | 'organizationId'>) {
    return {
      configurable: {
        thread_id: `jaafar:graph:${scope?.organizationId ?? 'personal'}:${scope?.userId ?? 'anonymous'}:${runId}`,
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
