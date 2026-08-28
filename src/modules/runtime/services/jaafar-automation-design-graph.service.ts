import { Annotation, Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import {
  AUTOMATION_BLUEPRINT_SYSTEM_PROMPT,
  JAAFAR_IDENTITY_SYSTEM_PROMPT,
  TOOL_USE_POLICY_SYSTEM_PROMPT,
} from '../../../infrastructure/prompts/system-prompts';
import {
  type AutomationBlueprint,
  automationBlueprintSchema,
  blueprintRevision,
} from '../../automations/schemas/automation-blueprint.schema';
import { AutomationsService } from '../../automations/services/automations.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
import {
  type AutomationDesignSession,
  AutomationDesignSessionService,
} from './automation-design-session.service';
import { ContextBuilderService } from './context-builder.service';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import { type ExecuteResponse } from './runtime.service';

export interface JaafarAutomationDesignGraphInput {
  runId: string;
  agentId: string;
  userMessage: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  effort?: 'low' | 'medium' | 'high';
  mode?: string;
}

export interface AutomationDesignApprovalDecision {
  approved: boolean;
  blueprintRevision?: string;
  reason?: string;
}

interface AutomationDesignGraphState {
  input: JaafarAutomationDesignGraphInput;
  context?: Awaited<ReturnType<JaafarContextLoaderService['load']>>;
  session: AutomationDesignSession;
  blueprint?: AutomationBlueprint;
  response?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  execution?: { durationMs?: number; estimatedCost?: number };
}

const AutomationDesignGraphState = Annotation.Root({
  input: Annotation<JaafarAutomationDesignGraphInput>({
    default: () => ({ runId: '', agentId: '', userMessage: '' }),
    reducer: (_left, right) => right,
  }),
  context: Annotation<AutomationDesignGraphState['context']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  session: Annotation<AutomationDesignSession>({
    default: () => ({
      status: 'GATHERING_REQUIREMENTS',
      approvalStatus: 'NOT_READY',
      missingRequirements: [],
    }),
    reducer: (_left, right) => right,
  }),
  blueprint: Annotation<AutomationBlueprint | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  response: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  usage: Annotation<AutomationDesignGraphState['usage']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  execution: Annotation<AutomationDesignGraphState['execution']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
});

/**
 * Jaafar automation design loop: understand → gather requirements (never
 * guesses) → emit a validated AutomationBlueprint grounded in chat, memory
 * and knowledge bases → explicit approval gate → provision into the
 * CLIENT's n8n instance via AutomationsService.
 */
@Injectable()
export class JaafarAutomationDesignGraphService {
  private readonly logger = new Logger(JaafarAutomationDesignGraphService.name);
  private readonly memoryCheckpointer = new MemorySaver();

  constructor(
    private readonly runs: RunsService,
    private readonly conversations: ConversationsService,
    private readonly contextLoader: JaafarContextLoaderService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly sessionService: AutomationDesignSessionService,
    private readonly llmRuntime: LLMRuntimeService,
    private readonly automations: AutomationsService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
  ) {}

  async run(input: Omit<JaafarAutomationDesignGraphInput, 'runId'>): Promise<ExecuteResponse> {
    const run = await this.runs.create({
      agentId: input.agentId,
      conversationId: input.conversationId,
      userId: input.userId,
      organizationId: input.organizationId,
      metadata: {
        runtimeMode: 'automation_design',
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
      this.logger.error(`Automation design graph run ${run.id} failed: ${message}`);
      await this.runs.fail(run.id, message);
      throw error;
    }
  }

  async resume(
    runId: string,
    decision: AutomationDesignApprovalDecision,
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
    let session = metadata.automationDesign as Record<string, unknown> | undefined;
    if (!session && run.conversationId) {
      try {
        const conv = await this.conversations.findByIdInScope(run.conversationId, scope ?? {});
        const convMeta = (conv?.metadata as Record<string, unknown> | null) ?? {};
        session = convMeta.automationDesign as Record<string, unknown> | undefined;
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
      await this.runs.fail(runId, decision.reason ?? 'Automation design was rejected');
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response:
          decision.reason ?? 'The automation design was rejected and nothing was provisioned.',
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
    return new StateGraph(AutomationDesignGraphState)
      .addNode('load_design_session', async (state) => {
        const context = await this.contextLoader.load({
          agentId: state.input.agentId,
          userMessage: state.input.userMessage,
          conversationId: state.input.conversationId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          mode: 'automation_design',
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
        if (!state.context) throw new Error('Automation design context was not loaded');
        const history = state.context.history;
        const context = await this.contextBuilder.build({
          systemPrompt: [
            JAAFAR_IDENTITY_SYSTEM_PROMPT,
            TOOL_USE_POLICY_SYSTEM_PROMPT,
            AUTOMATION_BLUEPRINT_SYSTEM_PROMPT,
            'Continue the existing automation design session. Ask only for requirements that materially affect a safe, useful automation. Never guess missing requirements.',
            `Current structured session:\n${JSON.stringify(state.session)}`,
            `Automation policies:\n${state.context.agent.instructions ?? ''}`,
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
          schema: automationBlueprintSchema,
          temperature: 0.2,
          maxTokens: 2000,
        });
        const blueprint = automationBlueprintSchema.parse(result.object);
        const validation = this.validateBlueprint(blueprint);
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
        if (!state.blueprint) throw new Error('Automation blueprint was not generated');
        const ready = state.blueprint.ready;
        const revision = blueprintRevision(state.blueprint);
        const session: AutomationDesignSession = {
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
          runtimeMode: 'automation_design',
          automationDesign: session,
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
          type: 'automation_design_approval',
          runId: state.input.runId,
          blueprintRevision: state.session.blueprintRevision,
        });
        return {};
      })
      .addNode('provision_automation', async (state) => {
        // Approval has been granted by the human gate; create + provision now.
        const blueprint = state.blueprint;
        if (!blueprint) throw new Error('Approved automation blueprint is missing');
        const scope = {
          userId: state.input.userId,
          organizationId: state.input.organizationId,
        };
        const created = await this.automations.createFromBlueprint(
          {
            name: blueprint.name,
            description: blueprint.description || blueprint.summary,
            blueprint: blueprint as unknown as Record<string, unknown>,
          },
          scope,
        );
        const provisioned = await this.automations.approve(created.id, scope);
        if (provisioned.status === 'FAILED') {
          throw new Error(
            provisioned.lastError ?? 'Automation provisioning failed in the client n8n instance',
          );
        }
        const session: AutomationDesignSession = {
          ...(state.session ?? {
            status: 'PROVISIONED',
            approvalStatus: 'APPROVED',
            missingRequirements: [],
          }),
          status: 'PROVISIONED',
          approvalStatus: 'APPROVED',
          automationId: provisioned.id,
          connectionId: provisioned.connectionId,
        };
        await this.sessionService.persist({
          runId: state.input.runId,
          conversationId: state.input.conversationId,
          session,
        });
        await this.runs.updateMetadata(state.input.runId, {
          automationId: provisioned.id,
          automationStatus: provisioned.status,
          webhookPath: provisioned.webhookPath,
        });
        return {
          session,
          response: `Automation "${provisioned.name}" is now ACTIVE in your n8n instance (webhook: ${provisioned.webhookPath ?? 'n/a'}).`,
        };
      })
      .addEdge(START, 'load_design_session')
      .addEdge('load_design_session', 'collect_requirements')
      .addEdge('collect_requirements', 'persist_design_turn')
      .addConditionalEdges(
        'persist_design_turn',
        (state) => (state.session.status === 'READY_FOR_REVIEW' ? 'approval' : 'complete'),
        { approval: 'await_approval', complete: END },
      )
      .addEdge('await_approval', 'provision_automation')
      .addEdge('provision_automation', END)
      .compile({ checkpointer: this.checkpointer() });
  }

  graphConfig(
    runId: string,
    scope?: Pick<JaafarAutomationDesignGraphInput, 'userId' | 'organizationId'>,
  ) {
    return {
      configurable: {
        thread_id: `jaafar:automation-design:${scope?.organizationId ?? 'personal'}:${scope?.userId ?? 'anonymous'}:${runId}`,
      },
    };
  }

  private validateBlueprint(blueprint: AutomationBlueprint): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!blueprint.goal?.trim()) missing.push('A clear goal for the automation');
    if (!blueprint.trigger?.type) missing.push('A trigger (webhook, schedule, manual, or chat)');
    if (!blueprint.steps?.length) missing.push('At least one concrete step');
    if (!blueprint.integrations?.length && !blueprint.steps.some((step) => step.integration)) {
      missing.push('At least one integration the automation will use');
    }
    return { valid: missing.length === 0, missing };
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
  ): result is AutomationDesignGraphState & { __interrupt__: unknown } {
    return Boolean(result && typeof result === 'object' && '__interrupt__' in result);
  }

  private result(
    runId: string,
    result: AutomationDesignGraphState,
    status: 'WAITING' | 'COMPLETED',
  ): ExecuteResponse {
    return {
      runId,
      mode: 'automation_design',
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
      mode: 'automation_design',
      status: 'FAILED',
      response: `This automation design is not available in the current ${scope} scope.`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private formatSummary(blueprint: AutomationBlueprint, revision: string): string {
    if (!blueprint.ready) {
      return [
        'I need a little more information before I can prepare the automation design:',
        '',
        ...blueprint.missingRequirements.map((item) => `- ${item}`),
      ].join('\n');
    }
    return [
      `Draft automation blueprint: ${blueprint.name}`,
      '',
      `Goal: ${blueprint.goal}`,
      `Trigger: ${blueprint.trigger.type}`,
      '',
      blueprint.summary,
      '',
      'Steps:',
      ...blueprint.steps.map(
        (step, index) =>
          `- ${index + 1}. ${step.name} — ${step.action}${step.integration ? ` (via ${step.integration})` : ''}`,
      ),
      '',
      `Integrations: ${blueprint.integrations.join(', ') || 'None specified'}`,
      '',
      ...(blueprint.riskNotes.length
        ? ['Risk notes:', ...blueprint.riskNotes.map((item) => `- ${item}`), '']
        : []),
      `Blueprint revision: ${revision}`,
      'This design is ready for your review. Nothing has been provisioned yet. Confirm this design when you want me to create the automation in your n8n instance.',
    ].join('\n');
  }
}
