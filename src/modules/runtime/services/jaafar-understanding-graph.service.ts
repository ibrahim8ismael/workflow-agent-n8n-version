import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { RunsService } from '../../runs/runs.service';
import type { JaafarModelCall } from '../types/jaafar-model.types';
import type { JaafarPlan } from '../types/jaafar-plan.types';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import { JaafarPlanningService } from './jaafar-planning.service';
import {
  JaafarRequestUnderstandingService,
  type RequestUnderstandingResult,
} from './jaafar-request-understanding.service';

export interface JaafarUnderstandingGraphInput {
  runId?: string;
  agentId: string;
  userMessage: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  effort?: 'low' | 'medium' | 'high';
}

const UnderstandingGraphState = Annotation.Root({
  input: Annotation<JaafarUnderstandingGraphInput>({
    default: () => ({ agentId: '', userMessage: '' }),
    reducer: (_left, right) => right,
  }),
  context: Annotation<Awaited<ReturnType<JaafarContextLoaderService['load']>> | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  understanding: Annotation<RequestUnderstandingResult | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  plan: Annotation<JaafarPlan | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  modelCalls: Annotation<JaafarModelCall[]>({
    default: () => [],
    reducer: (left, right) => [...left, ...right],
  }),
});

@Injectable()
export class JaafarUnderstandingGraphService {
  private readonly memoryCheckpointer = new MemorySaver();

  constructor(
    private readonly contextLoader: JaafarContextLoaderService,
    private readonly understandingService: JaafarRequestUnderstandingService,
    private readonly planningService: JaafarPlanningService,
    private readonly runsService: RunsService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
  ) {}

  build(options: { durable?: boolean } = {}) {
    return new StateGraph(UnderstandingGraphState)
      .addNode('load_context', async (state) => ({
        context: await this.contextLoader.load({
          agentId: state.input.agentId,
          userMessage: state.input.userMessage,
          conversationId: state.input.conversationId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          mode: 'planning',
        }),
      }))
      .addNode('understand_request', async (state) => {
        if (!state.context) throw new Error('Understanding context was not loaded');
        const understanding = await this.understandingService.understand({
          userMessage: state.input.userMessage,
          history: state.context.history,
          agentName: state.context.agent.name,
          agentInstructions: state.context.agent.instructions,
          memoryReferences: state.context.memoryReferences,
          knowledgeReferences: state.context.knowledgeReferences,
          effort: state.input.effort,
        });
        if (state.input.runId) {
          await this.runsService.recordModelUsage?.(
            state.input.runId,
            understanding.modelCall.usage,
            understanding.modelCall.execution.estimatedCost,
          );
        }
        return { understanding, modelCalls: [understanding.modelCall] };
      })
      .addNode('plan_task', async (state) => {
        if (!state.context || !state.understanding) {
          throw new Error('Planning requires loaded context and understanding');
        }
        const planningResult = await this.planningService.createPlanResult({
          understanding: state.understanding,
          tools: state.context.tools,
          userMessage: state.input.userMessage,
          agentName: state.context.agent.name,
          agentInstructions: state.context.agent.instructions,
          history: state.context.history,
          effort: state.input.effort,
        });
        if (state.input.runId) {
          await this.runsService.savePlan(
            state.input.runId,
            planningResult.plan as unknown as Record<string, unknown>,
          );
          await this.runsService.recordModelUsage?.(
            state.input.runId,
            planningResult.modelCall.usage,
            planningResult.modelCall.execution.estimatedCost,
          );
        }
        return { plan: planningResult.plan, modelCalls: [planningResult.modelCall] };
      })
      .addEdge(START, 'load_context')
      .addEdge('load_context', 'understand_request')
      .addConditionalEdges(
        'understand_request',
        (state) => state.understanding?.route ?? 'clarification',
        {
          clarification: END,
          conversation: END,
          employee_design: END,
          task_execution: 'plan_task',
          general_question: END,
        },
      )
      .addEdge('plan_task', END)
      .compile(options.durable ? { checkpointer: this.checkpointer() } : undefined);
  }

  graphConfig(
    runId: string,
    scope?: Pick<JaafarUnderstandingGraphInput, 'userId' | 'organizationId'>,
  ) {
    return {
      configurable: {
        thread_id: `jaafar:understanding:${scope?.organizationId ?? 'personal'}:${scope?.userId ?? 'anonymous'}:${runId}`,
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
