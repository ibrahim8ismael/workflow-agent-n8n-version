import { Annotation, Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import {
  BLUEPRINT_GENERATOR_SYSTEM_PROMPT,
  JAAFAR_IDENTITY_SYSTEM_PROMPT,
  TOOL_USE_POLICY_SYSTEM_PROMPT,
} from '../../../infrastructure/prompts/system-prompts';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import { blueprintSchema } from '../employee-design/employee-blueprint.schema';
import { validateEmployeeBlueprint } from '../employee-design/employee-blueprint.validation';
import { blueprintRevision } from '../employee-design/employee-blueprint-revision';
import { EmployeeDesignRuntimeService } from '../employee-design/employee-design-runtime.service';
import type {
  EmployeeBlueprint,
  EmployeeDesignSession,
} from '../employee-design/employee-design-session.types';
import type { ToolDefinition } from '../interfaces/tool.interface';
import { ContextBuilderService } from './context-builder.service';
import { EmployeeDesignSessionService } from './employee-design-session.service';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import { type ExecuteResponse } from './runtime.service';
import { ToolExecutorService } from './tool-executor.service';

export interface JaafarEmployeeDesignGraphInput {
  runId: string;
  agentId: string;
  userMessage: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  effort?: 'low' | 'medium' | 'high';
}

export interface EmployeeDesignApprovalDecision {
  approved: boolean;
  blueprintRevision?: string;
  reason?: string;
}

interface EmployeeDesignGraphState {
  input: JaafarEmployeeDesignGraphInput;
  context?: Awaited<ReturnType<JaafarContextLoaderService['load']>>;
  session: EmployeeDesignSession;
  blueprint?: EmployeeBlueprint;
  response?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  execution?: { durationMs?: number; estimatedCost?: number };
}

const EmployeeDesignGraphState = Annotation.Root({
  input: Annotation<JaafarEmployeeDesignGraphInput>({
    default: () => ({ runId: '', agentId: '', userMessage: '' }),
    reducer: (_left, right) => right,
  }),
  context: Annotation<EmployeeDesignGraphState['context']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  session: Annotation<EmployeeDesignSession>({
    default: () => ({
      status: 'GATHERING_REQUIREMENTS',
      approvalStatus: 'NOT_READY',
      missingRequirements: [],
    }),
    reducer: (_left, right) => right,
  }),
  blueprint: Annotation<EmployeeBlueprint | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  response: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  usage: Annotation<EmployeeDesignGraphState['usage']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  execution: Annotation<EmployeeDesignGraphState['execution']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
});

@Injectable()
export class JaafarEmployeeDesignGraphService {
  private readonly logger = new Logger(JaafarEmployeeDesignGraphService.name);
  private readonly memoryCheckpointer = new MemorySaver();

  constructor(
    private readonly runs: RunsService,
    private readonly conversations: ConversationsService,
    private readonly contextLoader: JaafarContextLoaderService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly sessionService: EmployeeDesignSessionService,
    private readonly llmRuntime: LLMRuntimeService,
    @Optional() private readonly employeeDesignRuntime?: EmployeeDesignRuntimeService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
    @Optional() private readonly toolExecutor?: ToolExecutorService,
  ) {}

  async run(input: Omit<JaafarEmployeeDesignGraphInput, 'runId'>): Promise<ExecuteResponse> {
    const run = await this.runs.create({
      agentId: input.agentId,
      conversationId: input.conversationId,
      userId: input.userId,
      organizationId: input.organizationId,
      metadata: {
        runtimeMode: 'employee_design',
        designStatus: 'DRAFT',
        approvalStatus: 'PENDING',
      },
    });
    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      await this.runs.transitionStatus(run.id, 'PLANNING');
      const result = await this.build().invoke(
        { input: { ...input, runId: run.id } },
        this.graphConfig(run.id, input),
      );
      if (this.isInterrupted(result)) {
        await this.runs.transitionStatus(run.id, 'WAITING');
        return this.result(run.id, result, 'WAITING');
      }
      const completed = await this.runs.complete(run.id, result.response);
      return this.result(completed.id, result, 'COMPLETED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Employee design graph run ${run.id} failed: ${message}`);
      await this.runs.fail(run.id, message);
      throw error;
    }
  }

  async resume(
    runId: string,
    decision: EmployeeDesignApprovalDecision,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<ExecuteResponse> {
    const run = await this.runs.findById(runId);
    if (scope && run.userId && run.userId !== scope.userId) {
      return this.scopeFailure(runId, 'user');
    }
    if (scope && run.organizationId && run.organizationId !== scope.organizationId) {
      return this.scopeFailure(runId, 'organization');
    }
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    let session = metadata.employeeDesign as Record<string, unknown> | undefined;
    if (!session && run.conversationId) {
      try {
        const conv = await this.conversations.findByIdInScope(run.conversationId, scope ?? {});
        const convMeta = (conv?.metadata as Record<string, unknown> | null) ?? {};
        session = convMeta.employeeDesign as Record<string, unknown> | undefined;
      } catch {
        // ignore
      }
    }
    const revision =
      decision.blueprintRevision ||
      (typeof session?.blueprintRevision === 'string' ? session.blueprintRevision : undefined) ||
      (typeof metadata.blueprintRevision === 'string' ? metadata.blueprintRevision : undefined);

    if (!decision.approved) {
      await this.runs.updateMetadata(runId, {
        approvalStatus: 'REJECTED',
        rejectionReason: decision.reason,
      });
      await this.runs.fail(runId, decision.reason ?? 'Employee design was rejected');
      return {
        runId,
        mode: 'employee_design',
        status: 'FAILED',
        response:
          decision.reason ?? 'The employee design was rejected and no employee was created.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    await this.runs.transitionStatus(runId, 'EXECUTING');
    const result = await this.build().invoke(
      new Command({ resume: { approved: true, blueprintRevision: revision } }),
      this.graphConfig(runId, {
        userId: scope?.userId ?? run.userId ?? undefined,
        organizationId: scope?.organizationId ?? run.organizationId ?? undefined,
      }),
    );
    const completed = await this.runs.complete(runId, result.response);
    return this.result(completed.id, result, 'COMPLETED');
  }

  build() {
    return new StateGraph(EmployeeDesignGraphState)
      .addNode('load_design_session', async (state) => {
        const context = await this.contextLoader.load({
          agentId: state.input.agentId,
          userMessage: state.input.userMessage,
          conversationId: state.input.conversationId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          mode: 'employee_design',
        });
        const session = await this.sessionService.load({
          conversationId: state.input.conversationId,
          runId: state.input.runId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
        });
        return { context, session };
      })
      .addNode('collect_requirements', async (state) => {
        if (!state.context) throw new Error('Employee design context was not loaded');
        const history = state.context.history;
        const context = await this.contextBuilder.build({
          systemPrompt: [
            JAAFAR_IDENTITY_SYSTEM_PROMPT,
            TOOL_USE_POLICY_SYSTEM_PROMPT,
            BLUEPRINT_GENERATOR_SYSTEM_PROMPT,
            'Continue the existing employee design session. Ask only for requirements that materially affect a safe, useful employee.',
            `Current structured session:\n${JSON.stringify(state.session)}`,
            `Employee policies:\n${state.context.agent.instructions ?? ''}`,
          ].join('\n\n'),
          agentId: state.input.agentId,
          conversationId: state.input.conversationId,
          organizationId: state.input.organizationId,
          userId: state.input.userId,
          userMessage: state.input.userMessage,
          conversationHistory: history,
        });
        const result = await this.llmRuntime.generateObject({
          mode: state.input.effort ?? 'medium',
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
        const validation = validateEmployeeBlueprint(blueprint);
        const missingRequirements =
          blueprint.ready && validation.valid
            ? blueprint.missingRequirements
            : Array.from(new Set([...blueprint.missingRequirements, ...validation.missing]));
        const ready = validation.valid && missingRequirements.length === 0;
        return {
          blueprint: { ...blueprint, ready, missingRequirements },
          usage: result.usage,
          execution: result.execution,
        };
      })
      .addNode('persist_design_turn', async (state) => {
        if (!state.blueprint) throw new Error('Employee blueprint was not generated');
        const ready = state.blueprint.ready;
        const revision = blueprintRevision(state.blueprint);
        const session: EmployeeDesignSession = {
          status: ready ? 'READY_FOR_REVIEW' : 'GATHERING_REQUIREMENTS',
          approvalStatus: ready ? 'READY' : 'NOT_READY',
          blueprint: state.blueprint,
          missingRequirements: state.blueprint.missingRequirements,
          blueprintRevision: revision,
          sourceConversationId: state.input.conversationId,
          sourceDesignRunId: state.input.runId,
        };
        const response = this.formatSummary(state.blueprint, revision);
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
        await this.runs.updateMetadata(state.input.runId, {
          runtimeMode: 'employee_design',
          employeeDesign: session,
          blueprint: state.blueprint,
          designStatus: session.status,
          approvalStatus: session.approvalStatus,
          missingRequirements: session.missingRequirements,
          blueprintRevision: session.blueprintRevision,
          execution: state.execution,
        });
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
            content: response,
          });
        }
        await this.sessionService.persist({
          runId: state.input.runId,
          conversationId: state.input.conversationId,
          session,
        });
        return { session, response };
      })
      .addNode('await_approval', (state) => {
        if (!state.session.blueprintRevision) {
          throw new Error('A blueprint revision is required before approval');
        }
        interrupt({
          type: 'employee_design_approval',
          runId: state.input.runId,
          blueprintRevision: state.session.blueprintRevision,
        });
        return {};
      })
      .addNode('create_employee', async (state) => {
        if (this.toolExecutor) {
          const result = await this.toolExecutor.execute(this.employeeCreationTool(), {
            runId: state.input.runId,
            agentId: state.input.agentId,
            userMessage: state.input.userMessage,
            input: { blueprint: state.blueprint ?? {} },
            userId: state.input.userId,
            organizationId: state.input.organizationId,
            approvalStatus: 'approved',
            logicalAction: 'employee-design-create',
          });
          if (!result.success) throw new Error(result.error?.message ?? 'Employee creation failed');
          return { response: `Employee draft created: ${JSON.stringify(result.output)}` };
        }
        if (!this.employeeDesignRuntime)
          throw new Error('Employee creation tool is not configured');
        const result = await this.employeeDesignRuntime.confirm(
          state.input.runId,
          {
            userId: state.input.userId,
            organizationId: state.input.organizationId,
          },
          { blueprintRevision: state.session.blueprintRevision },
        );
        return { response: result.response };
      })
      .addEdge(START, 'load_design_session')
      .addEdge('load_design_session', 'collect_requirements')
      .addEdge('collect_requirements', 'persist_design_turn')
      .addConditionalEdges(
        'persist_design_turn',
        (state) => (state.session.status === 'READY_FOR_REVIEW' ? 'approval' : 'complete'),
        { approval: 'await_approval', complete: END },
      )
      .addEdge('await_approval', 'create_employee')
      .addEdge('create_employee', END)
      .compile({ checkpointer: this.checkpointer() });
  }

  graphConfig(
    runId: string,
    scope?: Pick<JaafarEmployeeDesignGraphInput, 'userId' | 'organizationId'>,
  ) {
    return {
      configurable: {
        thread_id: `jaafar:employee-design:${scope?.organizationId ?? 'personal'}:${scope?.userId ?? 'anonymous'}:${runId}`,
      },
    };
  }

  private employeeCreationTool(): ToolDefinition {
    return {
      id: 'employee_create_draft',
      name: 'Create employee draft',
      slug: 'employee-create-draft',
      description: 'Create an employee draft from an approved blueprint.',
      executionMode: 'domain',
      inputSchema: { type: 'object', required: ['blueprint'] },
      outputSchema: { type: 'object' },
      requiredPermissions: ['employee:create'],
      requiredIntegrations: [],
      requiresApproval: true,
      sideEffect: true,
      timeoutMs: 30_000,
      maxRetries: 0,
      retryPolicy: { maxAttempts: 1, retryableCodes: [] },
      idempotent: true,
      successCriteria: ['Employee draft is created'],
      permissionScope: 'agent',
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

  private isInterrupted(
    result: unknown,
  ): result is EmployeeDesignGraphState & { __interrupt__: unknown } {
    return Boolean(result && typeof result === 'object' && '__interrupt__' in result);
  }

  private result(
    runId: string,
    result: EmployeeDesignGraphState,
    status: 'WAITING' | 'COMPLETED',
  ): ExecuteResponse {
    return {
      runId,
      mode: 'employee_design',
      status,
      response: result.response ?? '',
      plan: result.blueprint
        ? { ...result.blueprint, blueprintRevision: result.session.blueprintRevision }
        : undefined,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private scopeFailure(runId: string, scope: 'user' | 'organization'): ExecuteResponse {
    return {
      runId,
      mode: 'employee_design',
      status: 'FAILED',
      response: `This employee plan is not available in the current ${scope} scope.`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private formatSummary(blueprint: EmployeeBlueprint, revision: string): string {
    if (!blueprint.ready) {
      return [
        'I need a little more information before I can prepare the employee draft:',
        '',
        ...blueprint.missingRequirements.map((item) => `- ${item}`),
      ].join('\n');
    }
    return [
      `Draft employee blueprint: ${blueprint.name}`,
      '',
      `Role: ${blueprint.role}`,
      `Department: ${blueprint.department}`,
      `Description: ${blueprint.description}`,
      '',
      blueprint.summary,
      '',
      'Responsibilities:',
      ...blueprint.responsibilities.map((item) => `- ${item}`),
      '',
      'Goals:',
      ...blueprint.goals.map((item) => `- ${item}`),
      '',
      'Knowledge:',
      ...blueprint.knowledgeRequirements.map((item) => `- ${item}`),
      '',
      `Tools: ${blueprint.requiredTools.join(', ') || 'None specified'}`,
      `Integrations: ${blueprint.requiredIntegrations.join(', ') || 'None specified'}`,
      `Channels: ${blueprint.channels.join(', ') || 'None specified'}`,
      '',
      'Permissions and boundaries:',
      ...blueprint.permissions.map((item) => `- ${item}`),
      '',
      `Memory policy: ${blueprint.memoryPolicy}`,
      `Workflow: ${blueprint.workflow.join('; ') || 'None specified'}`,
      '',
      `Blueprint revision: ${revision}`,
      'This plan is ready for your review. The employee has not been created. Confirm this plan when you want me to create the employee draft.',
    ].join('\n');
  }
}
