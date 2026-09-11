import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LangGraphCheckpointError } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { QuotaEnforcerService } from '../../billing/services/quota-enforcer.service';
import { SubscriptionService } from '../../billing/services/subscription.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { isTerminalRunStatus } from '../../runs/agent-run-phase';
import { RunsService } from '../../runs/runs.service';
import type { JaafarRuntimeServiceContract } from '../interfaces/jaafar-runtime.interface';
import { type ApprovalReplyDecision, classifyApprovalReply } from '../shared/approval-reply';
import { RuntimeMode, type RuntimeRequest } from '../types/runtime.types';
import type {
  ApprovalDecision,
  PendingApprovalContext,
  PendingQuestionContext,
  RuntimeErrorCode,
  RuntimeEvent,
  RuntimeResult,
  RuntimeScope,
  RuntimeUsage,
  StartRunRequest,
} from '../types/runtime-contract.types';
import {
  type AutomationGraphStreamEvent,
  type JaafarAutomationGraphInput,
  JaafarAutomationGraphService,
} from './jaafar-automation-graph.service';
import {
  type ConversationGraphStreamEvent,
  JaafarConversationGraphService,
} from './jaafar-conversation-graph.service';
import {
  type ExecutionGraphStreamEvent,
  JaafarExecutionGraphService,
} from './jaafar-execution-graph.service';
import {
  type JaafarGraphOutput,
  type JaafarGraphRoute,
  JaafarGraphService,
} from './jaafar-graph.service';
import { RuntimeService } from './runtime.service';
import { RuntimeBillingAccountingService } from './runtime-billing-accounting.service';
import { RuntimeEventJournalService } from './runtime-event-journal.service';
import { RuntimeObservabilityService } from './runtime-observability.service';

@Injectable()
export class JaafarRuntimeService implements JaafarRuntimeServiceContract {
  private readonly logger = new Logger(JaafarRuntimeService.name);
  constructor(
    @Optional() @Inject(RuntimeService) private readonly runtime: RuntimeService | undefined,
    private readonly runs: RunsService,
    private readonly conversations: ConversationsService,
    private readonly automationGraph: JaafarAutomationGraphService,
    private readonly executionGraph: JaafarExecutionGraphService,
    private readonly conversationGraph: JaafarConversationGraphService,
    private readonly jaafarGraph: JaafarGraphService,
    @Optional() private readonly eventJournal?: RuntimeEventJournalService,
    @Optional() private readonly billingAccounting?: RuntimeBillingAccountingService,
    @Optional() private readonly quota?: QuotaEnforcerService,
    @Optional() private readonly subscriptions?: SubscriptionService,
    @Optional() private readonly observability?: RuntimeObservabilityService,
  ) {}

  async start(request: StartRunRequest): Promise<RuntimeResult> {
    const rolloutFailure = this.rolloutFailure(request);
    if (rolloutFailure) return rolloutFailure;
    const quotaFailure = await this.checkStartupQuota(request);
    if (quotaFailure) return quotaFailure;

    const mode = request.mode ?? RuntimeMode.CONVERSATION;
    const runtimeRequest = { ...request, mode } as RuntimeRequest;

    const run = await this.runs.create({
      agentId: runtimeRequest.agentId,
      conversationId: runtimeRequest.conversationId,
      userId: runtimeRequest.userId,
      organizationId: runtimeRequest.organizationId,
      metadata: {
        runtimeMode: mode,
        userMessage: runtimeRequest.userMessage,
        // Webhook-dedup anchor (externalMessageId) for channel entry points.
        ...(runtimeRequest.channelMessageId
          ? { channelMessageId: runtimeRequest.channelMessageId }
          : {}),
      },
    });

    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      await this.runs.transitionStatus(run.id, 'PLANNING');

      const pendingContext = await this.loadPendingContext(runtimeRequest, run.id);
      // Chat-message approvals (blocking path): a short verdict on a design
      // parked at the approval gate resumes it instead of fresh classification.
      const chatApproval = await this.resolveChatApproval(runtimeRequest, run.id);
      if (chatApproval) {
        return this.applyChatApproval(run.id, chatApproval, runtimeRequest);
      }
      const graphInput = {
        ...runtimeRequest,
        runId: run.id,
        ...(pendingContext ? { pendingContext } : {}),
      };
      let understood: JaafarGraphOutput;
      try {
        understood = await this.jaafarGraph.classify(graphInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Classification failed for run ${run.id} — degrading to conversation: ${message}`,
        );
        const result = await this.conversationGraph.run(runtimeRequest);
        await this.handleGraphCompletion(run.id, {
          route: 'completed',
          response: result.response,
          usage: result.usage,
          modelCalls: [],
        });
        await this.recordEvent({
          type: 'run.completed',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: {
            response: result.response ?? '',
            usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          },
        });
        await this.recordBilling(run.id);
        return this.normalize({
          runId: run.id,
          mode: RuntimeMode.CONVERSATION,
          status: 'COMPLETED',
          response: result.response,
          usage: result.usage,
        });
      }

      const understanding = understood.understanding;
      const route = understanding?.route ?? 'clarification';

      if (route === 'clarification' || !understanding) {
        const response =
          understanding?.clarificationQuestion ??
          'I need more information before I can prepare that task.';
        await this.runs.updateMetadata(run.id, {
          intent: understanding?.intent,
          missingInputs: understanding?.missingInputs,
          clarificationQuestion: understanding?.clarificationQuestion,
        });
        await this.runs.transitionStatus(run.id, 'WAITING');
        // Persist the turn (blocking path) — the stream path does the same;
        // without this the next turn's context had no record of the exchange.
        if (runtimeRequest.conversationId) {
          await this.persistClarificationTurn(
            runtimeRequest.conversationId,
            runtimeRequest.userMessage,
            response,
          );
        }
        return {
          runId: run.id,
          mode: runtimeRequest.mode,
          status: 'WAITING',
          response,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }

      if (route === 'automation_design') {
        await this.runs.updateMetadata(run.id, {
          runtimeMode: RuntimeMode.AUTOMATION_DESIGN,
        });
        await this.runs.transitionStatus(run.id, 'EXECUTING');
        const automationInput = {
          runId: run.id,
          agentId: runtimeRequest.agentId,
          userMessage: runtimeRequest.userMessage,
          conversationId: runtimeRequest.conversationId,
          userId: runtimeRequest.userId,
          organizationId: runtimeRequest.organizationId,
          effort: runtimeRequest.effort,
          ...(pendingContext ? { pendingContext } : {}),
        };
        // V2 automation graph (Phase 3 cutover): the legacy design graph is retired.
        const result = await this.automationGraph.run(automationInput);
        if (result.status === 'WAITING') {
          // The V2 graph parks the row as WAITING itself; mirror it here
          // only when the row has not caught up yet (WAITING→WAITING is invalid).
          const current = await this.runs.findById(run.id);
          if (current.status !== 'WAITING') {
            await this.runs.transitionStatus(run.id, 'WAITING');
          }
          await this.recordEvent({
            type: 'run.waiting',
            runId: run.id,
            occurredAt: new Date().toISOString(),
            payload: { reason: 'approval' },
          });
          return this.normalize({
            runId: run.id,
            mode: RuntimeMode.AUTOMATION_DESIGN,
            status: 'WAITING',
            response: result.response as string | undefined,
            plan: result.plan as unknown as Record<string, unknown>,
            usage: result.usage as RuntimeUsage | undefined,
          });
        }
        await this.handleGraphCompletion(run.id, {
          route: 'completed',
          response: result.response as string | undefined,
          usage: result.usage as RuntimeUsage | undefined,
          modelCalls: [],
        });
        await this.recordEvent({
          type: 'run.completed',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: {
            response: (result.response as string) ?? '',
            usage: (result.usage as RuntimeUsage) ?? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          },
        });
        await this.recordBilling(run.id);
        return this.normalize({
          runId: run.id,
          mode: RuntimeMode.AUTOMATION_DESIGN,
          status: 'COMPLETED',
          response: result.response as string | undefined,
          plan: result.plan as unknown as Record<string, unknown>,
          usage: result.usage as RuntimeUsage | undefined,
        });
      }

      if (route === 'conversation' || route === 'general_question') {
        const result = await this.conversationGraph.run(runtimeRequest);
        await this.handleGraphCompletion(run.id, {
          route: 'completed',
          response: result.response,
          usage: result.usage,
          modelCalls: [],
        });
        await this.recordEvent({
          type: 'run.completed',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: {
            response: result.response ?? '',
            usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          },
        });
        await this.recordBilling(run.id);
        return this.normalize({
          runId: run.id,
          mode: RuntimeMode.CONVERSATION,
          status: 'COMPLETED',
          response: result.response,
          usage: result.usage,
        });
      }

      await this.runs.transitionStatus(run.id, 'EXECUTING');
      const executionInput = {
        runId: run.id,
        agentId: runtimeRequest.agentId,
        userMessage: runtimeRequest.userMessage,
        conversationId: runtimeRequest.conversationId,
        userId: runtimeRequest.userId,
        organizationId: runtimeRequest.organizationId,
        tools: understood.context?.skills ?? [],
        plan: understood.plan,
      };
      await this.runs.updateMetadata(run.id, {
        executionGraphInput: executionInput,
        plan: understood.plan,
      });

      const result = await this.executeGraphBranch(
        run.id,
        understood.plan,
        executionInput,
        understanding.route,
      );

      for (const modelCall of result.modelCalls ?? []) {
        const mc = modelCall as { usage?: RuntimeUsage; execution?: { estimatedCost?: number } };
        if (mc.usage) {
          await this.runs.recordModelUsage(run.id, mc.usage, mc.execution?.estimatedCost);
          this.observability?.recordModel(mc.execution as any);
        }
      }
      // The execution graph's `usage` is a HarnessUsage (steps/tool calls) —
      // token accounting comes from the model calls, not a cast.
      const executionUsage: RuntimeUsage = (result.modelCalls ?? []).reduce<RuntimeUsage>(
        (totals, modelCall) => {
          const usage = (modelCall as { usage?: RuntimeUsage }).usage;
          if (!usage) return totals;
          return {
            promptTokens: totals.promptTokens + (usage.promptTokens ?? 0),
            completionTokens: totals.completionTokens + (usage.completionTokens ?? 0),
            totalTokens: totals.totalTokens + (usage.totalTokens ?? 0),
          };
        },
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      );

      if (result.route === 'waiting') {
        await this.runs.transitionStatus(run.id, 'WAITING');
        return {
          runId: run.id,
          mode: RuntimeMode.EXECUTION,
          status: 'WAITING',
          response: 'The task is waiting for approval before continuing.',
          plan: understood.plan as unknown as Record<string, unknown>,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
      if (result.route === 'failed') {
        await this.runs.fail(run.id, result.error?.message ?? 'Task execution failed');
      } else if (typeof this.runs.complete === 'function') {
        await this.runs.complete(run.id, result.response ?? '');
      }

      const status = result.route === 'failed' ? 'FAILED' : 'COMPLETED';
      if (result.route === 'failed') {
        await this.recordEvent({
          type: 'run.failed',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: {
            error: {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: result.error?.message ?? 'Execution failed',
              retryable: false,
            },
          },
        });
      } else {
        await this.recordEvent({
          type: 'run.completed',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: {
            response: result.response ?? '',
            usage: executionUsage,
          },
        });
      }
      await this.recordBilling(run.id);
      return this.normalize({
        runId: run.id,
        mode: RuntimeMode.EXECUTION,
        status,
        response: result.response,
        plan: understood.plan as unknown as Record<string, unknown>,
        usage: executionUsage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Task graph failed';
      try {
        await this.runs.fail(run.id, message);
      } catch {
        /* best-effort */
      }
      throw error;
    }
  }

  async *stream(request: StartRunRequest): AsyncGenerator<RuntimeEvent> {
    const rolloutFailure = this.rolloutFailure(request);
    if (rolloutFailure) {
      yield this.eventFromFailure(rolloutFailure);
      return;
    }
    // Same quota gate as the blocking path — the SSE entry point must not
    // become a quota bypass for run creation + LLM spend.
    const quotaFailure = await this.checkStartupQuota(request);
    if (quotaFailure) {
      yield this.eventFromFailure(quotaFailure);
      return;
    }

    const mode = request.mode ?? RuntimeMode.CONVERSATION;
    const runtimeRequest = { ...request, mode } as RuntimeRequest;

    const run = await this.runs.create({
      agentId: runtimeRequest.agentId,
      conversationId: runtimeRequest.conversationId,
      userId: runtimeRequest.userId,
      organizationId: runtimeRequest.organizationId,
      metadata: {
        runtimeMode: mode,
        userMessage: runtimeRequest.userMessage,
        // Webhook-dedup anchor (externalMessageId) for channel entry points.
        ...(runtimeRequest.channelMessageId
          ? { channelMessageId: runtimeRequest.channelMessageId }
          : {}),
      },
    });

    let terminal = false;

    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      await this.runs.transitionStatus(run.id, 'PLANNING');

      const pendingContext = await this.loadPendingContext(runtimeRequest, run.id);
      // Chat-message approvals (stream path): a short verdict ("ok i
      // approve") on a design parked at the approval gate resumes that run
      // instead of classifying a fresh design — otherwise every approval
      // loops back into a new blueprint and nothing is ever provisioned.
      const chatApproval = await this.resolveChatApproval(runtimeRequest, run.id);
      if (chatApproval) {
        // Keep the SSE stream alive across the blocking resume (provisioning
        // takes a while) — the client renders progress, not a frozen spinner.
        if (chatApproval.decision === 'approve') {
          yield {
            type: 'token',
            runId: chatApproval.pending.runId,
            occurredAt: new Date().toISOString(),
            payload: { content: 'On it — building your automation now ⏳\n' },
          };
        }
        try {
          const result = await this.applyChatApproval(run.id, chatApproval, runtimeRequest);
          yield this.chatApprovalTerminalEvent(chatApproval.pending.runId, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Approval failed';
          yield {
            type: 'run.failed',
            runId: chatApproval.pending.runId,
            occurredAt: new Date().toISOString(),
            payload: {
              error: {
                code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
                message,
                retryable: false,
              },
            },
          };
        }
        return;
      }
      const graphInput = {
        ...runtimeRequest,
        runId: run.id,
        ...(pendingContext ? { pendingContext } : {}),
      };
      let understood: JaafarGraphOutput;
      try {
        understood = await this.jaafarGraph.classify(graphInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Classification failed for run ${run.id} — degrading to conversation: ${message}`,
        );
        await this.abandonStreamingRun(run.id, 'classifier_unavailable');
        for await (const event of this.conversationGraph.stream(runtimeRequest)) {
          yield this.mapConversationStreamEvent(event);
        }
        return;
      }

      const understanding = understood.understanding;
      const route = understanding?.route ?? 'clarification';

      if (route === 'clarification' || !understanding) {
        const question =
          understanding?.clarificationQuestion ??
          'What outcome would you like Jaafar to help you achieve?';
        await this.runs.updateMetadata(run.id, {
          intent: understanding?.intent,
          missingInputs: understanding?.missingInputs,
          clarificationQuestion: question,
        });
        await this.runs.transitionStatus(run.id, 'WAITING');
        if (runtimeRequest.conversationId) {
          await this.persistClarificationTurn(
            runtimeRequest.conversationId,
            runtimeRequest.userMessage,
            question,
          );
        }
        // Surface the question as content — the SSE client only renders
        // token/run.completed payloads; a bare run.waiting would look like
        // Jaafar froze mid-answer.
        yield {
          type: 'token',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: { content: question },
        };
        yield {
          type: 'run.waiting',
          runId: run.id,
          occurredAt: new Date().toISOString(),
          payload: { reason: 'clarification' },
        };
        return;
      }

      if (route === 'automation_design') {
        await this.runs.updateMetadata(run.id, {
          runtimeMode: RuntimeMode.AUTOMATION_DESIGN,
        });
        const automationInput = {
          runId: run.id,
          agentId: runtimeRequest.agentId,
          userMessage: runtimeRequest.userMessage,
          conversationId: runtimeRequest.conversationId,
          userId: runtimeRequest.userId,
          organizationId: runtimeRequest.organizationId,
          effort: runtimeRequest.effort,
          ...(pendingContext ? { pendingContext } : {}),
        };
        for await (const event of this.automationGraph.stream(automationInput)) {
          const mapped = this.mapAutomationGraphEvent(event);
          terminal =
            mapped.type === 'run.completed' ||
            mapped.type === 'run.waiting' ||
            mapped.type === 'run.failed' ||
            mapped.type === 'run.cancelled';
          await this.applyTerminalStreamStatus(mapped);
          await this.recordEvent(mapped);
          if (terminal) await this.recordBilling(mapped.runId);
          yield mapped;
        }
        return;
      }

      if (route === 'conversation' || route === 'general_question') {
        // The conversation graph creates and streams through its OWN run —
        // park ours as superseded so PLANNING rows don't pile up forever.
        await this.abandonStreamingRun(run.id, 'superseded_by_conversation_run');
        for await (const event of this.conversationGraph.stream(runtimeRequest)) {
          const mapped = this.mapConversationStreamEvent(event);
          terminal =
            mapped.type === 'run.completed' ||
            mapped.type === 'run.waiting' ||
            mapped.type === 'run.failed' ||
            mapped.type === 'run.cancelled';
          await this.recordEvent(mapped);
          if (terminal) await this.recordBilling(mapped.runId);
          yield mapped;
        }
        return;
      }

      await this.runs.transitionStatus(run.id, 'EXECUTING');
      const executionInput = {
        runId: run.id,
        agentId: runtimeRequest.agentId,
        userMessage: runtimeRequest.userMessage,
        conversationId: runtimeRequest.conversationId,
        userId: runtimeRequest.userId,
        organizationId: runtimeRequest.organizationId,
        tools: understood.context?.skills ?? [],
        plan: understood.plan,
      };
      await this.runs.updateMetadata(run.id, {
        executionGraphInput: executionInput,
        plan: understood.plan,
      });

      for await (const event of this.executionGraph.stream(
        executionInput as import('./jaafar-execution-graph.service').JaafarExecutionGraphInput,
      )) {
        const mapped = this.mapExecutionStreamEvent(event);
        if (!mapped) continue;
        terminal =
          mapped.type === 'run.completed' ||
          mapped.type === 'run.waiting' ||
          mapped.type === 'run.failed' ||
          mapped.type === 'run.cancelled';
        await this.applyTerminalStreamStatus(mapped);
        await this.recordEvent(mapped);
        if (terminal) await this.recordBilling(mapped.runId);
        yield mapped;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Graph stream failed';
      try {
        await this.runs.fail(run.id, message);
      } catch {
        /* best-effort */
      }
      yield {
        type: 'run.failed',
        runId: run.id,
        occurredAt: new Date().toISOString(),
        payload: {
          error: { code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode, message, retryable: false },
        },
      };
    }
  }

  async resume(runId: string, scope?: RuntimeScope): Promise<RuntimeResult> {
    const run = await this.runs.findById(runId);
    if (!this.matchesScope(run, scope)) return this.failure(runId, 'Run scope does not match.');

    try {
      // V2 automation runs resume through their own approval gate, which
      // expects the WAITING status — only execution runs pre-transition here.
      if (!this.isAutomationDesignRun(run)) {
        try {
          await this.runs.transitionStatus(runId, 'EXECUTING');
        } catch (error) {
          if (error instanceof ConflictException) {
            // Another caller (or a duplicate resume) already claimed the
            // WAITING→EXECUTING transition — report it instead of a 500.
            return this.normalize({
              runId,
              status: 'FAILED',
              response: 'This run is already being processed. Refresh to see its current state.',
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              error: {
                code: 'INVALID_REQUEST' as RuntimeErrorCode,
                message: `Run ${runId} was claimed concurrently`,
                retryable: false,
              },
            });
          }
          throw error;
        }
      }
      const result = await this.resumeGraphBranch(runId, true, scope);
      // A resumed graph can hit ANOTHER approval gate (multi-step plans with
      // several side-effecting tools). Park the row again so the next
      // approve() routes through the graph path instead of falling into the
      // legacy handler on a non-WAITING row.
      if (result.status === 'WAITING' || result.route === 'waiting') {
        const current = await this.runs.findById(runId);
        if (current.status !== 'WAITING' && !isTerminalRunStatus(current.status)) {
          try {
            await this.runs.transitionStatus(runId, 'WAITING');
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            /* row moved concurrently — the graph's own parking wins */
          }
        }
      }
      const mode =
        ((run.metadata as Record<string, unknown> | null)?.runtimeMode as RuntimeMode) ??
        RuntimeMode.CONVERSATION;
      const normalized = this.normalize({
        runId,
        mode,
        status:
          result.status === 'FAILED' || result.route === 'failed'
            ? 'FAILED'
            : result.status === 'WAITING' || result.route === 'waiting'
              ? 'WAITING'
              : 'COMPLETED',
        response: result.response as string | undefined,
        plan: result.plan as unknown as Record<string, unknown>,
        usage: (result.usage as RuntimeUsage) ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      });
      const eventStatus =
        normalized.status === 'FAILED'
          ? 'failed'
          : normalized.status === 'WAITING'
            ? 'waiting'
            : 'completed';
      if (eventStatus === 'failed') {
        await this.recordEvent({
          type: 'run.failed',
          runId,
          occurredAt: new Date().toISOString(),
          payload: {
            error: normalized.error ?? {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: 'Resume failed',
              retryable: false,
            },
          },
        });
      } else if (eventStatus === 'waiting') {
        await this.recordEvent({
          type: 'run.waiting',
          runId,
          occurredAt: new Date().toISOString(),
          payload: { reason: 'approval' },
        });
      } else {
        await this.recordEvent({
          type: 'run.completed',
          runId,
          occurredAt: new Date().toISOString(),
          payload: { response: normalized.response ?? '', usage: normalized.usage },
        });
      }
      await this.recordBilling(runId);
      return normalized;
    } catch (error) {
      const code = this.checkpointErrorCode(error);
      // The graph usually fails the row itself first (V2 failRun) — only
      // mark FAILED when the row is still open, never crash a double-fail.
      try {
        await this.runs.fail(
          runId,
          code === ('CHECKPOINT_INCOMPATIBLE' as RuntimeErrorCode)
            ? 'Checkpoint state is incompatible.'
            : 'Checkpoint could not be loaded.',
        );
      } catch {
        /* row already terminal */
      }
      // Prefer the row's recorded reason (e.g. the V2 provisioning error)
      // over the generic checkpoint message.
      let message = 'The run checkpoint could not be resumed safely.';
      try {
        const failed = await this.runs.findById(runId);
        if (failed.error) message = failed.error;
      } catch {
        /* keep generic */
      }
      return {
        runId,
        mode: RuntimeMode.EXECUTION,
        status: 'FAILED',
        error: {
          code,
          message,
          retryable: false,
        },
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  async approve(
    runId: string,
    decision: ApprovalDecision,
    scope?: RuntimeScope,
  ): Promise<RuntimeResult> {
    const run = await this.runs.findById(runId);
    if (!this.matchesScope(run, scope)) return this.failure(runId, 'Run scope does not match.');

    if (!decision.approved) {
      // Rejection parks the run as CANCELLED — but never re-closes a row
      // that already reached a terminal state (TOCTOU: the row can complete
      // between the check and the cancel; the CAS cancel throws then).
      if (!isTerminalRunStatus(run.status)) {
        try {
          await this.runs.cancel(runId);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          /* row closed concurrently — report its current state below */
        }
      }
      return {
        runId,
        mode: RuntimeMode.EXECUTION,
        status: 'CANCELLED',
        response: decision.reason ?? 'Task execution was rejected.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    // All automation designs resume through the V2 graph (which answers
    // gracefully when the run is no longer waiting); execution graph runs
    // resume through the execution graph; anything else is legacy.
    if (this.isAutomationDesignRun(run)) return this.resume(runId, scope);
    const isGraphRun = this.isGraphExecution(run);
    if (!isGraphRun && (run.metadata as Record<string, unknown> | null)?.executionGraphInput) {
      // A V2 execution run that is no longer WAITING (already claimed by a
      // concurrent approve, or completed) must never fall through to the
      // legacy handler — that path cannot resume the graph checkpoint and
      // would strand the run.
      return this.normalize({
        runId,
        status: 'FAILED',
        response: `This run is no longer waiting for approval (status=${run.status}).`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: {
          code: 'INVALID_REQUEST' as RuntimeErrorCode,
          message: `Run ${runId} is not WAITING (status=${run.status})`,
          retryable: false,
        },
      });
    }
    if (!isGraphRun && this.runtime) {
      const legacyResult = decision.approved
        ? await this.runtime.approve(runId)
        : await this.runtime.reject(runId, decision.reason);
      return this.normalize({
        runId: legacyResult.runId,
        status: legacyResult.status ?? 'COMPLETED',
        response: legacyResult.response,
        usage: legacyResult.usage,
      });
    }

    return this.resume(runId, scope);
  }

  async reject(runId: string, reason?: string, scope?: RuntimeScope): Promise<RuntimeResult> {
    return this.approve(runId, { approved: false, reason }, scope);
  }

  /**
   * Retries a FAILED automation run from its failed stage (§43) — e.g. after
   * the user reconnects a credential. Non-automation and non-repairable runs
   * get a plain explanation instead of a retry.
   */
  async retryAutomation(runId: string, scope?: RuntimeScope): Promise<RuntimeResult> {
    const run = await this.runs.findById(runId);
    if (!this.matchesScope(run, scope)) return this.failure(runId, 'Run scope does not match.');
    if (!this.isAutomationDesignRun(run)) {
      return {
        runId,
        status: 'FAILED',
        response: 'Only automation runs can be retried. Send a new message to start another run.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: {
          code: 'INVALID_REQUEST' as RuntimeErrorCode,
          message: `Run ${runId} is not an automation run`,
          retryable: false,
        },
      };
    }
    try {
      const result = await this.automationGraph.retryFromFailure(runId, scope);
      const normalized = this.normalize({
        runId,
        mode: RuntimeMode.AUTOMATION_DESIGN,
        status: result.status ?? 'FAILED',
        response: result.response as string | undefined,
        plan: result.plan as unknown as Record<string, unknown>,
        usage: (result.usage as RuntimeUsage) ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      });
      if (normalized.status === 'FAILED') {
        await this.recordEvent({
          type: 'run.failed',
          runId,
          occurredAt: new Date().toISOString(),
          payload: {
            error: normalized.error ?? {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: normalized.response ?? 'Retry failed',
              retryable: false,
            },
          },
        });
      } else if (normalized.status === 'WAITING') {
        // The retry can hit the deferral gate again (connection dropped) —
        // park the row and journal a wait, never a fake completion.
        try {
          const current = await this.runs.findById(runId);
          if (current.status !== 'WAITING' && !isTerminalRunStatus(current.status)) {
            await this.runs.transitionStatus(runId, 'WAITING');
          }
        } catch {
          /* row state is managed by the graph's own advance */
        }
        await this.recordEvent({
          type: 'run.waiting',
          runId,
          occurredAt: new Date().toISOString(),
          payload: { reason: 'approval' },
        });
      } else {
        await this.recordEvent({
          type: 'run.completed',
          runId,
          occurredAt: new Date().toISOString(),
          payload: { response: normalized.response ?? '', usage: normalized.usage },
        });
      }
      await this.recordBilling(runId);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation retry failed';
      await this.recordEvent({
        type: 'run.failed',
        runId,
        occurredAt: new Date().toISOString(),
        payload: {
          error: {
            code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
            message,
            retryable: false,
          },
        },
      });
      await this.recordBilling(runId);
      return this.normalize({
        runId,
        mode: RuntimeMode.AUTOMATION_DESIGN,
        status: 'FAILED',
        response: message,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    }
  }

  /**
   * Builds a plan previously saved as a draft (no n8n connection at design
   * time) without replanning. The run must be WAITING with a stored
   * automationPlan artifact, and an ACTIVE n8n connection must exist now.
   */
  async buildDeferredAutomation(runId: string, scope?: RuntimeScope): Promise<RuntimeResult> {
    const run = await this.runs.findById(runId);
    if (!this.matchesScope(run, scope)) return this.failure(runId, 'Run scope does not match.');
    if (!this.isAutomationDesignRun(run)) {
      return {
        runId,
        status: 'FAILED',
        response:
          'Only deferred automation plans can be built. Send a new message to start another run.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: {
          code: 'INVALID_REQUEST' as RuntimeErrorCode,
          message: `Run ${runId} is not an automation run`,
          retryable: false,
        },
      };
    }
    try {
      const result = await this.automationGraph.provisionDeferred(runId, scope);
      const normalized = this.normalize({
        runId,
        mode: RuntimeMode.AUTOMATION_DESIGN,
        status: result.status ?? 'FAILED',
        response: result.response as string | undefined,
        plan: result.plan as unknown as Record<string, unknown>,
        usage: (result.usage as RuntimeUsage) ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      });
      if (normalized.status === 'FAILED') {
        await this.recordEvent({
          type: 'run.failed',
          runId,
          occurredAt: new Date().toISOString(),
          payload: {
            error: normalized.error ?? {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: normalized.response ?? 'Deferred build failed',
              retryable: false,
            },
          },
        });
      } else if (normalized.status === 'WAITING') {
        // Deferred build hit the still-no-connection gate — make sure the
        // row mirrors WAITING before the caller renders the message.
        try {
          const current = await this.runs.findById(runId);
          if (current.status !== 'WAITING' && !isTerminalRunStatus(current.status)) {
            await this.runs.transitionStatus(runId, 'WAITING');
          }
        } catch {
          /* row state is managed by the graph's own advance */
        }
        await this.recordEvent({
          type: 'run.waiting',
          runId,
          occurredAt: new Date().toISOString(),
          payload: { reason: 'approval' },
        });
      } else {
        await this.recordEvent({
          type: 'run.completed',
          runId,
          occurredAt: new Date().toISOString(),
          payload: { response: normalized.response ?? '', usage: normalized.usage },
        });
      }
      await this.recordBilling(runId);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deferred build failed';
      await this.recordEvent({
        type: 'run.failed',
        runId,
        occurredAt: new Date().toISOString(),
        payload: {
          error: {
            code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
            message,
            retryable: false,
          },
        },
      });
      await this.recordBilling(runId);
      return this.normalize({
        runId,
        mode: RuntimeMode.AUTOMATION_DESIGN,
        status: 'FAILED',
        response: message,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    }
  }

  async cancel(runId: string, scope?: RuntimeScope): Promise<RuntimeResult> {
    const run = await this.runs.findById(runId);
    if (!this.matchesScope(run, scope)) return this.failure(runId, 'Run scope does not match.');
    let cancelled: typeof run;
    try {
      cancelled = await this.runs.cancel(runId);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      // The row closed between the read and the claim — report its real
      // state instead of a 500 (or a dishonest CANCELLED).
      cancelled = await this.runs.findById(runId);
    }
    await this.recordBilling(cancelled.id);
    const alreadyFinished =
      isTerminalRunStatus(cancelled.status) && cancelled.status !== 'CANCELLED';
    return {
      runId: cancelled.id,
      status: 'CANCELLED',
      response: alreadyFinished
        ? `The run had already finished (${cancelled.status}) before it could be cancelled.`
        : 'Run cancelled.',
      usage: {
        promptTokens: cancelled.promptTokens,
        completionTokens: cancelled.completionTokens,
        totalTokens: cancelled.totalTokens,
      },
    };
  }

  private async executeGraphBranch(
    runId: string,
    _plan: unknown,
    executionInput: unknown,
    route: JaafarGraphRoute,
  ): Promise<{
    route: string;
    response?: string;
    modelCalls?: unknown[];
    usage?: RuntimeUsage;
    error?: { code: string; message: string; retryable: boolean };
  }> {
    if (route === 'automation_design') {
      const result = await this.automationGraph.run(executionInput as JaafarAutomationGraphInput);
      if (result.status === 'WAITING') return { route: 'waiting' };
      if (result.status === 'FAILED') {
        return { route: 'failed', response: result.response, error: undefined };
      }
      return {
        route: 'completed',
        response: result.response,
        modelCalls: [],
        usage: result.usage as RuntimeUsage | undefined,
        error: undefined,
      };
    }

    const result = await this.executionGraph.build({ durable: true }).invoke(
      {
        input:
          executionInput as import('./jaafar-execution-graph.service').JaafarExecutionGraphInput,
      },
      this.executionGraph.graphConfig(
        runId,
        executionInput as { userId?: string; organizationId?: string },
      ),
    );
    return this.mapExecutionResult(result);
  }

  private async resumeGraphBranch(
    runId: string,
    approved: boolean,
    scope?: RuntimeScope,
    reason?: string,
  ): Promise<Record<string, unknown>> {
    const run = await this.runs.findById(runId);
    const isAutomationDesign = this.isAutomationDesignRun(run);

    if (isAutomationDesign) {
      const result = await this.automationGraph.resume(runId, { approved, reason }, scope);
      return result as unknown as Record<string, unknown>;
    }

    const result = await this.executionGraph.resume(runId, approved, scope);
    return result as unknown as Record<string, unknown>;
  }

  private mapExecutionResult(result: Record<string, unknown>): {
    route: string;
    response?: string;
    modelCalls?: unknown[];
    usage?: RuntimeUsage;
    error?: { code: string; message: string; retryable: boolean };
  } {
    if (result.__interrupt__) {
      return { route: 'waiting' };
    }
    return {
      route: (result.route as string) ?? 'completed',
      response: result.response as string | undefined,
      modelCalls: result.modelCalls as unknown[] | undefined,
      usage: result.usage as RuntimeUsage | undefined,
      error: result.error as { code: string; message: string; retryable: boolean } | undefined,
    };
  }

  private mapExecutionStreamEvent(event: ExecutionGraphStreamEvent): RuntimeEvent | null {
    const occurredAt = new Date().toISOString();
    const runId = event.runId;
    switch (event.type) {
      case 'run.started':
        return { type: 'run.started', runId, occurredAt, payload: { status: 'CREATED' } };
      case 'graph.node.completed':
        return {
          type: 'graph.node.completed',
          runId,
          occurredAt,
          payload: { node: event.node, durationMs: event.durationMs },
        };
      case 'tool.started':
        return {
          type: 'tool.started',
          runId,
          occurredAt,
          payload: { callId: event.callId, toolName: event.toolName },
        };
      case 'tool.completed':
        return {
          type: 'tool.completed',
          runId,
          occurredAt,
          payload: { callId: event.callId, toolName: event.toolName, durationMs: event.durationMs },
        };
      case 'tool.failed':
        return {
          type: 'tool.failed',
          runId,
          occurredAt,
          payload: {
            callId: event.callId,
            toolName: event.toolName,
            error: {
              code: (event.error.code ?? 'UNKNOWN_RUNTIME_FAILURE') as RuntimeErrorCode,
              message: event.error.message,
              retryable: event.error.retryable,
            },
          },
        };
      case 'approval.required':
        return { type: 'approval.required', runId, occurredAt, payload: { reason: event.reason } };
      case 'run.waiting':
        return { type: 'run.waiting', runId, occurredAt, payload: { reason: event.reason } };
      case 'run.completed':
        return {
          type: 'run.completed',
          runId,
          occurredAt,
          payload: {
            response: event.response,
            usage: (event.usage as unknown as RuntimeUsage) ?? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          },
        };
      case 'run.failed':
        return {
          type: 'run.failed',
          runId,
          occurredAt,
          payload: {
            error: {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: event.message,
              retryable: false,
            },
          },
        };
      default:
        return null;
    }
  }

  private mapAutomationGraphEvent(event: AutomationGraphStreamEvent): RuntimeEvent {
    const occurredAt = new Date().toISOString();
    const runId = event.runId;
    switch (event.type) {
      case 'run.started':
        return { type: 'run.started', runId, occurredAt, payload: { status: 'CREATED' } };
      case 'token':
        return { type: 'token', runId, occurredAt, payload: { content: event.content } };
      case 'approval.required':
        return { type: 'approval.required', runId, occurredAt, payload: { reason: event.reason } };
      case 'run.waiting':
        return { type: 'run.waiting', runId, occurredAt, payload: { reason: event.reason } };
      case 'run.completed':
        return {
          type: 'run.completed',
          runId,
          occurredAt,
          payload: {
            response: event.response,
            usage: (event.usage as unknown as RuntimeUsage) ?? {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          },
        };
      case 'run.failed':
        return {
          type: 'run.failed',
          runId,
          occurredAt,
          payload: {
            error: {
              code: (event.code ?? 'UNKNOWN_RUNTIME_FAILURE') as RuntimeErrorCode,
              message: event.message,
              retryable: false,
            },
          },
        };
    }
  }

  private mapConversationStreamEvent(event: ConversationGraphStreamEvent): RuntimeEvent {
    const occurredAt = new Date().toISOString();
    switch (event.type) {
      case 'run.started':
        return {
          type: 'run.started',
          runId: event.runId,
          occurredAt,
          payload: { status: 'CREATED' },
        };
      case 'graph.node.started':
        return {
          type: 'graph.node.started',
          runId: event.runId,
          occurredAt,
          payload: { node: event.node },
        };
      case 'graph.node.completed':
        return {
          type: 'graph.node.completed',
          runId: event.runId,
          occurredAt,
          payload: { node: event.node, durationMs: event.durationMs },
        };
      case 'token':
        return {
          type: 'token',
          runId: event.runId,
          occurredAt,
          payload: { content: event.content },
        };
      case 'run.completed':
        return {
          type: 'run.completed',
          runId: event.runId,
          occurredAt,
          payload: { response: event.response, usage: event.usage },
        };
      case 'run.failed':
        return {
          type: 'run.failed',
          runId: event.runId,
          occurredAt,
          payload: {
            error: {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: event.message,
              retryable: false,
            },
          },
        };
    }
  }

  private async handleGraphCompletion(
    runId: string,
    result: {
      route?: string;
      response?: string;
      usage?: RuntimeUsage;
      modelCalls?: unknown[];
      error?: { message?: string };
    },
  ): Promise<void> {
    const route = result.route ?? 'completed';
    if (route === 'failed') {
      await this.runs.fail(runId, result.error?.message ?? 'Graph execution failed');
    } else if (route === 'waiting') {
      await this.runs.transitionStatus(runId, 'WAITING');
    } else if (typeof this.runs.complete === 'function') {
      // The V2 automation graph parks the row COMPLETED itself before the
      // wrapper mirrors the completion — a second terminal write throws
      // ("COMPLETED cannot move to COMPLETED") and would turn a successful
      // provisioning into an HTTP 500 with skipped billing.
      const current = await this.runs.findById(runId);
      if (!isTerminalRunStatus(current.status)) {
        await this.runs.complete(runId, result.response ?? '');
      }
    }
  }

  private normalize(result: {
    runId: string;
    status: string;
    response?: string;
    usage?: RuntimeUsage;
    plan?: unknown;
    error?: { code: string; message: string; retryable: boolean };
    mode?: string;
    conversationId?: string;
  }): RuntimeResult {
    return {
      runId: result.runId,
      status: result.status as RuntimeResult['status'],
      response: result.response,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      plan: result.plan as Record<string, unknown>,
      error: result.error
        ? {
            code: result.error.code as RuntimeErrorCode,
            message: result.error.message,
            retryable: result.error.retryable,
          }
        : undefined,
      mode: result.mode,
      conversationId: result.conversationId,
    };
  }

  private async recordEvent(event: RuntimeEvent): Promise<void> {
    try {
      await this.eventJournal?.append(event);
    } catch {
      // Best-effort
    }
  }

  private async recordBilling(runId: string): Promise<void> {
    try {
      await this.billingAccounting?.recordRun(runId);
    } catch {
      // Best-effort
    }
  }

  private rolloutFailure(request: StartRunRequest): RuntimeResult | undefined {
    if (process.env.JAAFAR_RUNTIME_KILL_SWITCH === 'true') {
      return this.failure('', 'Jaafar graph runtime is temporarily disabled.');
    }
    if (process.env.JAAFAR_RUNTIME_ENABLED === 'false') {
      return this.failure('', 'Jaafar graph runtime is not enabled.');
    }
    if (process.env.JAAFAR_RUNTIME_INTERNAL_ONLY === 'true' && !request.userId) {
      return this.failure('', 'Jaafar graph runtime is restricted to internal users.');
    }
    return undefined;
  }

  private async checkStartupQuota(request: StartRunRequest): Promise<RuntimeResult | undefined> {
    if (!this.quota || !this.subscriptions || !request.organizationId) return undefined;
    const subscription = await this.subscriptions.getCurrent(undefined, request.organizationId);
    if (!subscription) return undefined;
    const check = await this.quota.checkAiCredits(subscription.id, BigInt(1));
    if (!check.allowed) {
      return this.failure('', check.reason ?? 'Quota exceeded');
    }
    return undefined;
  }

  private checkpointErrorCode(error: unknown): RuntimeErrorCode {
    if (error instanceof LangGraphCheckpointError) return error.code as RuntimeErrorCode;
    if (error instanceof Error && error.message.includes('incompatible'))
      return 'CHECKPOINT_INCOMPATIBLE' as RuntimeErrorCode;
    return 'CHECKPOINT_FAILURE';
  }

  private matchesScope(
    run: { userId?: string | null; organizationId?: string | null },
    scope?: RuntimeScope,
  ): boolean {
    return (
      !scope ||
      ((!run.userId || run.userId === scope.userId) &&
        (!run.organizationId || run.organizationId === scope.organizationId))
    );
  }

  /**
   * Park a streaming run that will not drive its own lifecycle because the
   * conversation graph streams through a run it creates itself (or the
   * classifier failed and we degraded). Best-effort: the fallback must never
   * be blocked by bookkeeping.
   */
  private async abandonStreamingRun(runId: string, reason: string): Promise<void> {
    try {
      await this.runs.updateMetadata(runId, { supersededReason: reason });
      await this.runs.cancel(runId);
    } catch {
      /* best-effort */
    }
  }

  /** Mirrors terminal stream events onto the run row (SSE has no other writer). */
  private async applyTerminalStreamStatus(event: RuntimeEvent): Promise<void> {
    try {
      if (event.type === 'run.waiting') {
        await this.runs.transitionStatus(event.runId, 'WAITING');
      } else if (event.type === 'run.completed') {
        const response = (event.payload as { response?: string } | undefined)?.response;
        await this.runs.complete(event.runId, response);
      } else if (event.type === 'run.failed') {
        const message =
          (event.payload as { error?: { message?: string } } | undefined)?.error?.message ??
          'Stream failed';
        await this.runs.fail(event.runId, message);
      } else if (event.type === 'run.cancelled') {
        await this.runs.cancel(event.runId);
      }
    } catch {
      /* best-effort */
    }
  }

  /** Persists a clarification turn so the UI history survives a refresh. */
  private async persistClarificationTurn(
    conversationId: string,
    userMessage: string,
    question: string,
  ): Promise<void> {
    try {
      await this.conversations.addMessage(conversationId, {
        role: 'user',
        content: userMessage,
      });
      await this.conversations.titleFromFirstMessage(conversationId, userMessage);
      await this.conversations.addMessage(conversationId, {
        role: 'assistant',
        content: question,
      });
    } catch {
      /* best-effort */
    }
  }

  /**
   * Unanswered follow-up from the latest still-WAITING run in the same
   * conversation (scope-checked). Short replies arrive with no conversation
   * history when clarification turns persist nothing — this keeps the
   * original intent across turns. Never throws: classification must proceed
   * even when the lookup fails.
   */
  private async loadPendingContext(
    request: RuntimeRequest,
    currentRunId: string,
  ): Promise<PendingQuestionContext | undefined> {
    try {
      if (!request.conversationId) return undefined;
      const pending = await this.runs.findLatestWaitingInConversation(
        request.conversationId,
        currentRunId,
      );
      if (!pending) return undefined;
      if (
        !this.matchesScope(pending, {
          userId: request.userId,
          organizationId: request.organizationId,
        })
      ) {
        return undefined;
      }
      const metadata = (pending.metadata as Record<string, unknown> | null) ?? {};
      const question =
        typeof metadata.clarificationQuestion === 'string' && metadata.clarificationQuestion
          ? metadata.clarificationQuestion
          : undefined;
      if (!question) return undefined;
      const priorUserMessage =
        typeof metadata.userMessage === 'string' ? metadata.userMessage : undefined;
      const intent = typeof metadata.intent === 'string' ? metadata.intent : undefined;
      return {
        question,
        ...(priorUserMessage ? { priorUserMessage } : {}),
        ...(intent ? { intent } : {}),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Chat-message approval routing: a short verdict reply ("ok i approve",
   * "لا") to a design parked at the approval gate resolves to that run.
   * Fail-open — any miss returns undefined and the message flows through
   * normal classification exactly as before.
   */
  private async resolveChatApproval(
    request: RuntimeRequest,
    currentRunId: string,
  ): Promise<{ decision: 'approve' | 'reject'; pending: PendingApprovalContext } | undefined> {
    const decision: ApprovalReplyDecision = classifyApprovalReply(request.userMessage);
    if (decision === 'undecided') return undefined;
    const pending = await this.loadPendingApproval(request, currentRunId);
    if (!pending) return undefined;
    return { decision, pending };
  }

  /**
   * Latest still-WAITING design parked AT the approval interrupt in the same
   * conversation (scope-checked). Deferred drafts (checkpoint past the
   * interrupt), clarification waits, and legacy rows are excluded — resuming
   * those as approvals would corrupt their checkpoints.
   */
  private async loadPendingApproval(
    request: RuntimeRequest,
    currentRunId: string,
  ): Promise<PendingApprovalContext | undefined> {
    try {
      if (!request.conversationId) return undefined;
      const pending = await this.runs.findLatestWaitingInConversation(
        request.conversationId,
        currentRunId,
      );
      if (!pending) return undefined;
      if (
        !this.matchesScope(pending, {
          userId: request.userId,
          organizationId: request.organizationId,
        })
      ) {
        return undefined;
      }
      const metadata = (pending.metadata as Record<string, unknown> | null) ?? {};
      if (metadata.approvalPending !== true) return undefined;
      if (metadata.approvalGate !== undefined && metadata.approvalGate !== 'design_approval') {
        return undefined;
      }
      if (typeof metadata.clarificationQuestion === 'string' && metadata.clarificationQuestion) {
        return undefined;
      }
      return {
        runId: pending.id,
        ...(typeof metadata.approvalSummary === 'string'
          ? { summary: metadata.approvalSummary }
          : {}),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Drives a chat-message approval to completion on the parked run. The
   * just-created run is superseded (it drives no lifecycle of its own);
   * approve()/resume() journal events + billing on the parked run exactly as
   * the approve endpoint does.
   */
  private async applyChatApproval(
    newRunId: string,
    approval: { decision: 'approve' | 'reject'; pending: PendingApprovalContext },
    request: RuntimeRequest,
  ): Promise<RuntimeResult> {
    await this.abandonStreamingRun(newRunId, `superseded_by_chat_${approval.decision}`);
    // Persist the user turn BEFORE resuming — a mid-resume failure must
    // never erase it from history (Phase 0 lesson).
    if (request.conversationId) {
      try {
        await this.conversations.addMessage(request.conversationId, {
          role: 'user',
          content: request.userMessage,
        });
        await this.conversations.titleFromFirstMessage(request.conversationId, request.userMessage);
      } catch {
        /* best-effort */
      }
    }
    const scope = { userId: request.userId, organizationId: request.organizationId };
    if (approval.decision === 'approve') {
      const result = await this.resume(approval.pending.runId, scope);
      // A WAITING re-park (multi-gate resume) persists nothing itself — the
      // turn needs its answer. COMPLETED/FAILED went through complete/escalate,
      // which already persisted the assistant turn.
      if (result.status === 'WAITING') {
        await this.persistAssistantTurn(request.conversationId, result.response);
      }
      return result;
    }
    const arabic = /[\u0600-\u06FF]/.test(request.userMessage);
    const result = await this.approve(
      approval.pending.runId,
      {
        approved: false,
        reason: arabic
          ? 'تمام — تم رفض هذا التصميم ولن يتم إنشاء أي شيء. أرسل طلباً جديداً وسأجهز لك تصميماً جديداً.'
          : 'Understood — this design is rejected and nothing was provisioned. Send a new request anytime and I will draft a fresh design.',
      },
      scope,
    );
    // Rejection cancels the row without persisting — the turn needs its answer.
    await this.persistAssistantTurn(request.conversationId, result.response);
    return result;
  }

  /** Mirrors an approval result onto the SSE stream for the parked run. */
  private chatApprovalTerminalEvent(pendingRunId: string, result: RuntimeResult): RuntimeEvent {
    const occurredAt = new Date().toISOString();
    switch (result.status) {
      case 'COMPLETED':
        return {
          type: 'run.completed',
          runId: pendingRunId,
          occurredAt,
          payload: { response: result.response ?? '', usage: result.usage },
        };
      case 'WAITING':
        return {
          type: 'run.waiting',
          runId: pendingRunId,
          occurredAt,
          payload: { reason: 'approval' },
        };
      case 'CANCELLED':
        return {
          type: 'run.cancelled',
          runId: pendingRunId,
          occurredAt,
          payload: { reason: result.response },
        };
      default:
        return {
          type: 'run.failed',
          runId: pendingRunId,
          occurredAt,
          payload: {
            error: result.error ?? {
              code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
              message: result.response ?? 'Resume failed',
              retryable: false,
            },
          },
        };
    }
  }

  private async persistAssistantTurn(
    conversationId: string | undefined,
    response: string | undefined,
  ): Promise<void> {
    if (!conversationId || !response) return;
    try {
      await this.conversations.addMessage(conversationId, {
        role: 'assistant',
        content: response,
      });
    } catch {
      /* best-effort */
    }
  }

  private isAutomationDesignRun(run: { metadata: unknown }): boolean {
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    return (
      metadata.runtimeMode === RuntimeMode.AUTOMATION_DESIGN ||
      Boolean(metadata.automationDesign) ||
      Boolean(metadata.blueprint) ||
      Boolean(metadata.designStatus)
    );
  }

  private isGraphExecution(run: { metadata: unknown; status: string }): boolean {
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    return (
      metadata.runtimeMode === RuntimeMode.EXECUTION &&
      run.status === 'WAITING' &&
      Boolean(metadata.executionGraphInput)
    );
  }

  private failure(runId: string, message: string): RuntimeResult {
    return {
      runId,
      status: 'FAILED',
      response: message,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private eventFromFailure(failure: RuntimeResult): RuntimeEvent {
    return {
      type: 'run.failed',
      runId: failure.runId,
      occurredAt: new Date().toISOString(),
      payload: {
        error: {
          code: 'UNKNOWN_RUNTIME_FAILURE' as RuntimeErrorCode,
          message: failure.response ?? 'Runtime failed',
          retryable: false,
        },
      },
    };
  }
}
