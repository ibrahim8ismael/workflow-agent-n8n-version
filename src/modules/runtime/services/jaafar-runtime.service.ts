import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LangGraphCheckpointError } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { QuotaEnforcerService } from '../../billing/services/quota-enforcer.service';
import { SubscriptionService } from '../../billing/services/subscription.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { isTerminalRunStatus } from '../../runs/agent-run-phase';
import { RunsService } from '../../runs/runs.service';
import type { JaafarRuntimeServiceContract } from '../interfaces/jaafar-runtime.interface';
import { RuntimeMode, type RuntimeRequest } from '../types/runtime.types';
import type {
  ApprovalDecision,
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
      metadata: { runtimeMode: mode, userMessage: runtimeRequest.userMessage },
    });

    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      await this.runs.transitionStatus(run.id, 'PLANNING');

      const pendingContext = await this.loadPendingContext(runtimeRequest, run.id);
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
            usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
        usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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

    const mode = request.mode ?? RuntimeMode.CONVERSATION;
    const runtimeRequest = { ...request, mode } as RuntimeRequest;

    const run = await this.runs.create({
      agentId: runtimeRequest.agentId,
      conversationId: runtimeRequest.conversationId,
      userId: runtimeRequest.userId,
      organizationId: runtimeRequest.organizationId,
      metadata: { runtimeMode: mode, userMessage: runtimeRequest.userMessage },
    });

    let terminal = false;

    try {
      await this.runs.transitionStatus(run.id, 'PREPARING');
      await this.runs.transitionStatus(run.id, 'PLANNING');

      const pendingContext = await this.loadPendingContext(runtimeRequest, run.id);
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

    // V2 automation runs resume through their own approval gate, which
    // expects the WAITING status — only execution runs pre-transition here.
    if (!this.isAutomationDesignRun(run)) {
      await this.runs.transitionStatus(runId, 'EXECUTING');
    }
    try {
      const result = await this.resumeGraphBranch(runId, true, scope);
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
      // that already reached a terminal state.
      if (!isTerminalRunStatus(run.status)) {
        await this.runs.cancel(runId);
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

  async cancel(runId: string, scope?: RuntimeScope): Promise<RuntimeResult> {
    const run = await this.runs.findById(runId);
    if (!this.matchesScope(run, scope)) return this.failure(runId, 'Run scope does not match.');
    const cancelled = await this.runs.cancel(runId);
    await this.recordBilling(cancelled.id);
    return {
      runId: cancelled.id,
      status: 'CANCELLED',
      response: 'Run cancelled.',
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
      await this.runs.complete(runId, result.response ?? '');
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
