import { Annotation, Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { LangGraphPostgresCheckpointerService } from '../../../infrastructure/langgraph/langgraph-postgres-checkpointer.service';
import { LLMRuntimeService } from '../../../infrastructure/llm-runtime/llm-runtime.service';
import {
  N8nClientApiService,
  type N8nClientConnection,
} from '../../../infrastructure/n8n/n8n-client-api.service';
import {
  type N8nInstanceInventory,
  N8nNodeInventoryService,
} from '../../../infrastructure/n8n/n8n-node-inventory.service';
import {
  type AutomationBlueprint,
  automationBlueprintSchema,
  blueprintRevision,
} from '../../automations/schemas/automation-blueprint.schema';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { N8nConnectionsService } from '../../integrations/n8n/services/n8n-connections.service';
import { AgentRunService } from '../../runs/agent-run.service';
import { AGENT_RUN_PHASE } from '../../runs/agent-run-phase';
import { RunsService } from '../../runs/runs.service';
import type { JaafarUnderstanding } from '../types/jaafar-understanding.types';
import type { PendingQuestionContext } from '../types/runtime-contract.types';
import { AutomationErrorClassifierService } from './automation-error-classifier.service';
import { AutomationPlanReviewService } from './automation-plan-review.service';
import {
  AutomationRepairService,
  MAX_REPAIR_ATTEMPTS,
  type RepairStage,
} from './automation-repair.service';
import { AutomationRuntimeValidatorService } from './automation-runtime-validator.service';
import { AutomationWorkflowBuilderService } from './automation-workflow-builder.service';
import { IntegrationRegistryService } from './integration-registry.service';
import { JaafarContextLoaderService } from './jaafar-context-loader.service';
import { JaafarContextManagerService, type StageContext } from './jaafar-context-manager.service';
import type { RequestUnderstandingResult } from './jaafar-request-understanding.service';
import { JaafarRequestUnderstandingService } from './jaafar-request-understanding.service';
import { NodeResolverService } from './node-resolver.service';
import type { ExecuteResponse } from './runtime.service';

export interface JaafarAutomationGraphInput {
  runId?: string;
  agentId: string;
  userMessage: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  effort?: 'low' | 'medium' | 'high';
  /** Prior-turn follow-up (previous request + unanswered question). */
  pendingContext?: PendingQuestionContext;
  /** Pre-computed v2 understanding — skips re-classification when present. */
  understanding?: RequestUnderstandingResult;
  /** Retry entry after failure (§43): jumps START straight to this node. */
  retryFrom?: 'provision' | 'test_execute' | 'diagnose';
  /** Hydrated prior-pipeline state for retry (no rebuild). */
  blueprint?: AutomationBlueprint;
  automationId?: string;
  externalWorkflowId?: string | null;
  webhookPath?: string | null;
  requirements?: Array<{ id?: string; field: string; required: boolean }>;
  conditions?: string[];
  /**
   * Explicit user request to use generic HTTP/Code nodes for a specific
   * integration. Persisted on the run metadata at deferral time so
   * provisionDeferred()/retryFromFailure() can rebuild without it (the
   * understanding is not hydrated on those entry points).
   */
  genericNodeOverride?: { requested: boolean; type?: 'httpRequest' | 'code' };
  repairAttempt?: number;
  lastFailure?: { stage: RepairStage; message: string; code: string };
}

export interface AutomationApprovalDecision {
  approved: boolean;
  reason?: string;
}

export type AutomationGraphStreamEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'token'; runId: string; content: string }
  // Fired at the design approval gate so stream clients can render an
  // approve/reject affordance (mirrors the execution graph's gate event).
  // Carries the blueprint card fields so the client never has to scrape
  // chat text or read legacy design-session metadata.
  | {
      type: 'approval.required';
      runId: string;
      reason: string;
      blueprintName?: string;
      blueprintGoal?: string;
      triggerType?: string;
      stepCount?: number;
      blueprintRevision?: string;
      summary?: string;
    }
  | { type: 'run.waiting'; runId: string; reason: 'approval' | 'clarification' }
  | {
      type: 'run.completed';
      runId: string;
      response: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | { type: 'run.failed'; runId: string; code: string; message: string };

interface AutomationGraphState {
  input: JaafarAutomationGraphInput & { runId: string };
  understanding?: RequestUnderstandingResult;
  blueprint?: AutomationBlueprint;
  planAttempts: number;
  planFeedback?: string;
  clarificationOverride?: string;
  automationId?: string;
  externalWorkflowId?: string | null;
  webhookPath?: string | null;
  /** Credential-independent readiness carried from provision → complete. */
  buildable?: boolean;
  readyToRun?: boolean;
  /** True when live verification was skipped (connection lost after provisioning). */
  verifySkipped?: boolean;
  readinessBlockers?: Array<{
    nodeId: string;
    integration: string;
    credentialStatus: string;
    credentialType?: string;
    detail?: string;
  }>;
  verifyOk?: boolean;
  testOk?: boolean;
  lastFailure?: { stage: RepairStage; message: string; code: string };
  repairAttempt: number;
  diagnosis?: string;
  repairChanges?: string[];
  retryUnchanged?: boolean;
  nextStep?: 'provision' | 'test_execute';
  /**
   * True when the repair's own revalidation failed — routes repair back into
   * diagnose (while budget remains) instead of provisioning a known-invalid
   * blueprint.
   */
  repairFailed?: boolean;
  response?: string;
  escalated?: boolean;
  /**
   * True when provisioning was deferred because no ACTIVE n8n connection
   * exists. The validated plan is saved as a draft (run stays WAITING) and
   * can be provisioned later via provisionDeferred() without replanning.
   */
  deferred?: boolean;
  waitingReason?: 'approval' | 'clarification';
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const AutomationGraphState = Annotation.Root({
  input: Annotation<AutomationGraphState['input']>({
    default: () => ({ runId: '', agentId: '', userMessage: '' }),
    reducer: (_left, right) => right,
  }),
  understanding: Annotation<AutomationGraphState['understanding']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  blueprint: Annotation<AutomationGraphState['blueprint']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  planAttempts: Annotation<number>({ default: () => 0, reducer: (_left, right) => right }),
  planFeedback: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  clarificationOverride: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  automationId: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  externalWorkflowId: Annotation<string | null | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  webhookPath: Annotation<string | null | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  buildable: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  readyToRun: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  readinessBlockers: Annotation<AutomationGraphState['readinessBlockers']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  verifyOk: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  verifySkipped: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  testOk: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  lastFailure: Annotation<AutomationGraphState['lastFailure']>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  repairAttempt: Annotation<number>({ default: () => 0, reducer: (_left, right) => right }),
  diagnosis: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  repairChanges: Annotation<string[] | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  retryUnchanged: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  nextStep: Annotation<'provision' | 'test_execute' | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  repairFailed: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  escalated: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  deferred: Annotation<boolean | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  response: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  waitingReason: Annotation<'approval' | 'clarification' | undefined>({
    default: () => undefined,
    reducer: (_left, right) => right,
  }),
  usage: Annotation<AutomationGraphState['usage']>({
    default: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    reducer: (left, right) => ({
      promptTokens: left.promptTokens + right.promptTokens,
      completionTokens: left.completionTokens + right.completionTokens,
      totalTokens: left.totalTokens + right.totalTokens,
    }),
  }),
});

const MAX_PLAN_ATTEMPTS = 2;

/**
 * True when a blueprint-generation failure looks like output truncation
 * (finishReason `length`, cut-off markers) rather than a shape error. The
 * adapter's StructuredOutputError carries `details.finishReason`; raw
 * provider errors carry it in the message.
 */
function isTruncatedGeneration(error: unknown): boolean {
  if (error && typeof error === 'object' && 'details' in error) {
    const finishReason = (error as { details?: { finishReason?: unknown } }).details?.finishReason;
    if (typeof finishReason === 'string' && finishReason === 'length') return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /truncat|cut off|finish.?reason.{0,20}length|maximum context|max_tokens/i.test(message);
}

/**
 * Jaafar V2 automation graph (docs/Jaafar-improve.md §10–§22, Phase 3).
 *
 * understand → plan → review_plan (fix loop) → build → static_validate →
 * await_approval (human interrupt) → provision → verify.
 *
 * Every node advances the AgentRun state machine, so a run can always resume
 * from its last valid phase and COMPLETED requires the full pipeline —
 * Jaafar cannot report success before validation.
 */
@Injectable()
export class JaafarAutomationGraphService {
  private readonly logger = new Logger(JaafarAutomationGraphService.name);
  private readonly memoryCheckpointer = new MemorySaver();

  constructor(
    private readonly agentRuns: AgentRunService,
    private readonly runs: RunsService,
    private readonly conversations: ConversationsService,
    private readonly contextManager: JaafarContextManagerService,
    private readonly contextLoader: JaafarContextLoaderService,
    private readonly understandingService: JaafarRequestUnderstandingService,
    private readonly registry: IntegrationRegistryService,
    private readonly planReview: AutomationPlanReviewService,
    private readonly builder: AutomationWorkflowBuilderService,
    private readonly validator: AutomationRuntimeValidatorService,
    private readonly repair: AutomationRepairService,
    private readonly classifier: AutomationErrorClassifierService,
    private readonly llmRuntime: LLMRuntimeService,
    private readonly clientApi: N8nClientApiService,
    @Optional() private readonly n8nConnections?: N8nConnectionsService,
    @Optional() private readonly nodeInventory?: N8nNodeInventoryService,
    @Optional() private readonly postgresCheckpointer?: LangGraphPostgresCheckpointerService,
    @Optional() private readonly nodeResolver?: NodeResolverService,
  ) {}

  /** Blocking invoke (POST /runs path). */
  async run(input: JaafarAutomationGraphInput): Promise<ExecuteResponse> {
    const runId = await this.ensureRun(input);
    // Persist the user turn (blocking path) — the stream path persists it
    // itself; without this, direct-API automation history lost the user turn.
    if (input.conversationId) {
      await this.conversations.addMessage(input.conversationId, {
        role: 'user',
        content: input.userMessage,
      });
      await this.conversations.titleFromFirstMessage(input.conversationId, input.userMessage);
    }
    try {
      const result = await this.build().invoke(
        { input: { ...input, runId } },
        this.graphConfig(runId, input),
      );
      if (this.isInterrupted(result)) {
        await this.agentRuns.advance(runId, {
          toStatus: 'WAITING',
          reason: 'automation awaiting approval',
        });
        const summary = this.formatApprovalSummary(
          result.blueprint as AutomationBlueprint | undefined,
        );
        if (summary && input.conversationId) {
          await this.conversations.addMessage(input.conversationId, {
            role: 'assistant',
            content: summary,
          });
        }
        const waiting = this.result(runId, result, 'WAITING');
        return summary ? { ...waiting, response: summary } : waiting;
      }
      if (result.response === undefined) {
        throw new Error('Automation graph finished without a response');
      }
      return this.result(runId, result, 'COMPLETED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation run failed';
      this.logger.error(`Automation graph run ${runId} failed: ${message}`);
      await this.failRun(runId, message);
      // A design-stage failure is a product answer, not an HTTP 500: the
      // caller (and the user) gets the real reason with the explicit
      // guarantee that nothing was provisioned.
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response: `I couldn't finalize the automation design: ${this.designFailureMessage(message)} Nothing was provisioned.`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
  }

  /** SSE streaming invoke (POST /runs/stream path). */
  async *stream(input: JaafarAutomationGraphInput): AsyncGenerator<AutomationGraphStreamEvent> {
    const runId = await this.ensureRun(input);
    yield { type: 'run.started', runId };
    // Persist the user turn BEFORE generating — a mid-run failure must never
    // erase it from history (Phase 0 lesson).
    if (input.conversationId) {
      await this.conversations.addMessage(input.conversationId, {
        role: 'user',
        content: input.userMessage,
      });
      await this.conversations.titleFromFirstMessage(input.conversationId, input.userMessage);
    }
    try {
      const stream = await this.build().stream(
        { input: { ...input, runId } },
        { ...this.graphConfig(runId, input), streamMode: 'updates' },
      );
      yield* this.pumpGraphStream(runId, stream);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation run failed';
      await this.failRun(runId, message);
      yield {
        type: 'run.failed',
        runId,
        code: 'AUTOMATION_FAILED',
        message: `I couldn't finalize the automation design: ${this.designFailureMessage(message)} Nothing was provisioned.`,
      };
    }
  }

  /**
   * Resumes a WAITING run after the human approval gate. Rejections fail the
   * run with the human's reason; runs that predate the V2 graph get the
   * graceful "restate your request" message (cutover rule).
   */
  async resume(
    runId: string,
    decision: AutomationApprovalDecision,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<ExecuteResponse> {
    const guards = await this.checkResumeGuards(runId, scope);
    if (!guards.ok) {
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response: guards.response,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (!decision.approved) {
      await this.agentRuns.advance(runId, {
        toPhase: AGENT_RUN_PHASE.FAILED,
        toStatus: 'FAILED',
        reason: decision.reason ?? 'automation rejected at approval gate',
      });
      // Stamp the rejection on the run row: without this, retryFromFailure()
      // would hydrate the REJECTED blueprint, classify the rejection as an
      // UNKNOWN failure, "repair" it, and provision a design the user
      // explicitly refused — bypassing the approval gate entirely.
      try {
        await this.runs.updateMetadata(runId, {
          approvalDecision: 'rejected',
          approvalPending: false,
          rejectedAt: new Date().toISOString(),
          rejectionReason: decision.reason ?? 'automation rejected at approval gate',
        });
      } catch {
        /* best-effort: the FAILED advance above already closed the run */
      }
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response:
          decision.reason ?? 'The automation design was rejected — nothing was provisioned.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    try {
      const result = await this.build().invoke(
        new Command({ resume: { approved: true } }),
        this.graphConfig(runId, {
          userId: scope?.userId ?? guards.userId,
          organizationId: scope?.organizationId ?? guards.organizationId,
        }),
      );
      return this.result(runId, result, 'COMPLETED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation provisioning failed';
      await this.failRun(runId, message);
      throw error;
    }
  }

  /**
   * Streamed variant of resume() for chat approvals: same guards as resume(),
   * but the parked interrupt is resumed as a stream so the client sees real
   * progress (provisioning, verification, testing) instead of a frozen
   * spinner. Rejections are instant and stay on the blocking resume() path.
   */
  async *resumeStream(
    runId: string,
    scope?: { userId?: string; organizationId?: string },
  ): AsyncGenerator<AutomationGraphStreamEvent> {
    const guards = await this.checkResumeGuards(runId, scope);
    if (!guards.ok) {
      yield {
        type: 'run.failed',
        runId,
        code: 'AUTOMATION_RESUME_REJECTED',
        message: guards.response,
      };
      return;
    }
    try {
      const stream = await this.build().stream(new Command({ resume: { approved: true } }), {
        ...this.graphConfig(runId, {
          userId: scope?.userId ?? guards.userId,
          organizationId: scope?.organizationId ?? guards.organizationId,
        }),
        streamMode: 'updates',
      });
      yield* this.pumpGraphStream(runId, stream);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation provisioning failed';
      await this.failRun(runId, message);
      yield {
        type: 'run.failed',
        runId,
        code: 'AUTOMATION_FAILED',
        message: `Automation build failed: ${message.slice(0, 300)}. Nothing was activated — send a new message and I will try again.`,
      };
    }
  }

  /**
   * Shared update→event pump for stream() and resumeStream(): maps LangGraph
   * updates to SSE events, backfills completion usage from the run row, and
   * re-parks WAITING so a later approval routes through the graph path.
   */
  private async *pumpGraphStream(
    runId: string,
    stream: AsyncIterable<unknown>,
  ): AsyncGenerator<AutomationGraphStreamEvent> {
    for await (const update of stream) {
      for (const event of this.mapStreamUpdate(runId, update as Record<string, unknown>)) {
        if (event.type === 'run.completed') {
          // The complete node already persisted the assistant turn — a second
          // write here duplicated the completion message in every streamed
          // run's history. Token totals accumulated on the run row across
          // graph LLM calls.
          try {
            const row = await this.runs.findById(runId);
            (event as { usage: unknown }).usage = {
              promptTokens: Number(row.promptTokens ?? 0),
              completionTokens: Number(row.completionTokens ?? 0),
              totalTokens: Number(row.totalTokens ?? 0),
            };
          } catch {
            /* keep zero usage */
          }
        }
        yield event;
        if (event.type === 'run.waiting') {
          await this.agentRuns.advance(runId, {
            toStatus: 'WAITING',
            reason: `automation awaiting ${event.reason}`,
          });
        }
      }
    }
  }

  /**
   * Guards shared by resume() and resumeStream(): scope match, V2 run, and
   * still-WAITING status. Response texts match resume()'s legacy contract so
   * both entry points answer identically.
   */
  private async checkResumeGuards(
    runId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<
    { ok: true; userId?: string; organizationId?: string } | { ok: false; response: string }
  > {
    const snapshot = await this.agentRuns.snapshot(runId);
    const run = snapshot.run as {
      userId?: string | null;
      organizationId?: string | null;
      status: string;
      metadata?: unknown;
    };
    if (scope?.userId && run.userId && run.userId !== scope.userId) {
      return {
        ok: false,
        response: 'This automation is not available in the current user scope.',
      };
    }
    if (
      scope?.organizationId &&
      run.organizationId &&
      run.organizationId !== scope.organizationId
    ) {
      return {
        ok: false,
        response: 'This automation is not available in the current organization scope.',
      };
    }
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    if (!metadata.automationV2) {
      return {
        ok: false,
        response:
          'This design was started by the previous Jaafar version and cannot be approved anymore. Please restate your request and I will prepare a fresh design.',
      };
    }
    if (run.status !== 'WAITING') {
      return {
        ok: false,
        response: `This automation is no longer waiting for approval (status=${run.status}). Send a new message to start another design.`,
      };
    }
    return {
      ok: true,
      userId: run.userId ?? undefined,
      organizationId: run.organizationId ?? undefined,
    };
  }

  /**
   * Provisions a plan previously saved as a draft (no n8n connection at
   * design time) without replanning. Requires a WAITING run with
   * metadata.buildDeferred and a stored automationPlan artifact, plus an
   * ACTIVE n8n connection now. Reuses the provision→verify→test→complete
   * chain on a fresh checkpoint thread.
   */
  async provisionDeferred(
    runId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<ExecuteResponse> {
    const snapshot = await this.agentRuns.snapshot(runId);
    const run = snapshot.run as {
      agentId: string;
      userId?: string | null;
      organizationId?: string | null;
      conversationId?: string | null;
      status: string;
      metadata?: unknown;
      automationPlan?: unknown;
      requirements?: unknown;
      conditions?: unknown;
    };
    if (scope?.userId && run.userId && run.userId !== scope.userId) {
      return this.scopeFailure(runId, 'user');
    }
    if (
      scope?.organizationId &&
      run.organizationId &&
      run.organizationId !== scope.organizationId
    ) {
      return this.scopeFailure(runId, 'organization');
    }
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    if (!metadata.buildDeferred) {
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response:
          'This run has no deferred automation plan to build. Send a new message to start another design.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (run.status !== 'WAITING') {
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response: `This deferred plan is no longer waiting (status=${run.status}). Send a new message to start another design.`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (!run.automationPlan || typeof run.automationPlan !== 'object') {
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response:
          'The saved automation plan is missing, so there is nothing to build. Please restate your request and I will prepare a fresh design.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const userId = scope?.userId ?? run.userId ?? undefined;
    const organizationId = scope?.organizationId ?? run.organizationId ?? undefined;
    if (
      !(await this.hasActiveConnection({ userId, organizationId } as JaafarAutomationGraphInput))
    ) {
      return {
        runId,
        mode: 'automation_design',
        status: 'WAITING',
        response:
          'There is still no ACTIVE n8n connection, so the draft stays saved. Connect your n8n instance and try building again — no redesign needed.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const deferredBlueprint = run.automationPlan as AutomationBlueprint;
    const deferredRequirements = Array.isArray(run.requirements)
      ? (run.requirements as Array<{ id?: string; field: string; required: boolean }>)
      : [];
    const deferredConditions = Array.isArray(run.conditions) ? (run.conditions as string[]) : [];
    const genericNodeOverride =
      metadata.genericNodeOverride &&
      typeof metadata.genericNodeOverride === 'object' &&
      'requested' in (metadata.genericNodeOverride as Record<string, unknown>)
        ? (metadata.genericNodeOverride as JaafarAutomationGraphInput['genericNodeOverride'])
        : undefined;
    // The deferred build runs against a DIFFERENT n8n instance than the one
    // the plan was validated on (or none at all). Re-validate before
    // provisioning — otherwise the first failure surfaces as a raw n8n
    // createWorkflow error instead of a readable plan defect.
    try {
      const capabilities = await this.registry
        .capabilitiesForScope({ userId, organizationId })
        .catch(() => undefined);
      const revalidation = await this.builder.validateOnly({
        blueprint: deferredBlueprint,
        scope: { userId, organizationId },
        runId,
        requirements: deferredRequirements,
        conditions: deferredConditions,
        ...(capabilities ? { capabilities } : {}),
        ...(genericNodeOverride ? { genericOverride: genericNodeOverride } : {}),
      });
      if (!revalidation.valid) {
        const details = revalidation.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
        const message = `The saved plan no longer validates against the connected n8n instance: ${details}`;
        this.logger.warn(`Deferred build ${runId} rejected by re-validation: ${details}`);
        await this.failRun(runId, message);
        return {
          runId,
          mode: 'automation_design',
          status: 'FAILED',
          response: `The saved plan no longer validates against your connected n8n instance: ${details}. Tell me to adjust it and I'll prepare a fresh design.`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      }
    } catch (error) {
      // Best-effort guard: an infrastructure error in re-validation must not
      // block the deferred build — n8n still validates at creation time.
      this.logger.warn(
        `Deferred build ${runId} re-validation could not run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const result = await this.build().invoke(
        {
          input: {
            runId,
            agentId: run.agentId,
            userMessage: (metadata.userMessage as string) || 'Build the deferred automation plan',
            ...(run.conversationId ? { conversationId: run.conversationId } : {}),
            ...(userId ? { userId } : {}),
            ...(organizationId ? { organizationId } : {}),
            retryFrom: 'provision' as const,
            blueprint: deferredBlueprint,
            ...(deferredRequirements.length ? { requirements: deferredRequirements } : {}),
            ...(deferredConditions.length ? { conditions: deferredConditions } : {}),
            ...(genericNodeOverride ? { genericNodeOverride } : {}),
          },
        },
        this.graphConfig(
          runId,
          {
            ...(userId ? { userId } : {}),
            ...(organizationId ? { organizationId } : {}),
          },
          'deferred',
        ),
      );
      return this.result(runId, result, 'COMPLETED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deferred provisioning failed';
      await this.failRun(runId, message);
      throw error;
    }
  }

  /**
   * Retries a FAILED repairable run from its failed stage (§43) — no rebuild.
   * The blueprint, automation row, and repair-attempt count are rehydrated
   * from the run's artifacts; START jumps straight to the mapped node.
   */
  async retryFromFailure(
    runId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<ExecuteResponse> {
    const snapshot = await this.agentRuns.snapshot(runId);
    const run = snapshot.run as {
      userId?: string | null;
      organizationId?: string | null;
      status: string;
      currentPhase?: string;
      error?: string | null;
      metadata?: unknown;
      automationPlan?: unknown;
      requirements?: unknown;
      conditions?: unknown;
      executionResults?: unknown;
      repairAttempts?: unknown;
    };
    if (scope?.userId && run.userId && run.userId !== scope.userId) {
      return this.scopeFailure(runId, 'user');
    }
    if (
      scope?.organizationId &&
      run.organizationId &&
      run.organizationId !== scope.organizationId
    ) {
      return this.scopeFailure(runId, 'organization');
    }
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    if (!metadata.automationV2) {
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response:
          'This run was started by the previous Jaafar version and cannot be retried. Please restate your request and I will prepare a fresh design.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (!(await this.agentRuns.isRepairable(runId))) {
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response: `This automation run cannot be retried from its current state (status=${run.status}). Send a new message to start another design.`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    if (metadata.approvalDecision === 'rejected') {
      // The user explicitly rejected this design at the approval gate. A
      // retry must never "repair" it into provisioning — approval bypass.
      return {
        runId,
        mode: 'automation_design',
        status: 'FAILED',
        response: `You rejected this automation design${
          typeof metadata.rejectionReason === 'string' && metadata.rejectionReason
            ? ` (${metadata.rejectionReason})`
            : ''
        }, so I won't rebuild it. Send a new message and I'll prepare a fresh design that accounts for your feedback.`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }
    const execution = (run.executionResults as Record<string, unknown> | null) ?? {};
    const retryFrom =
      run.currentPhase === 'EXECUTING'
        ? ('provision' as const)
        : run.currentPhase === 'RUNTIME_VALIDATION'
          ? ('test_execute' as const)
          : ('diagnose' as const);
    try {
      // Fresh checkpoint thread: prior node outputs stay auditable on the old
      // thread while the retry runs from explicitly hydrated state. The
      // repair budget restarts — the user intervened with new information —
      // while the attempt trail keeps growing for audit.
      const result = await this.build().invoke(
        {
          input: {
            runId,
            agentId: snapshot.run.agentId,
            userMessage: (metadata.userMessage as string) || 'Retry the failed automation',
            conversationId: snapshot.run.conversationId ?? undefined,
            userId: snapshot.run.userId ?? undefined,
            organizationId: snapshot.run.organizationId ?? undefined,
            retryFrom,
            blueprint: run.automationPlan as AutomationBlueprint | undefined,
            automationId:
              typeof execution.automationId === 'string' ? execution.automationId : undefined,
            externalWorkflowId:
              typeof execution.externalWorkflowId === 'string'
                ? execution.externalWorkflowId
                : undefined,
            webhookPath:
              typeof execution.webhookPath === 'string' ? execution.webhookPath : undefined,
            requirements: Array.isArray(run.requirements)
              ? (run.requirements as Array<{ id?: string; field: string; required: boolean }>)
              : undefined,
            conditions: Array.isArray(run.conditions) ? (run.conditions as string[]) : undefined,
            ...(metadata.genericNodeOverride &&
            typeof metadata.genericNodeOverride === 'object' &&
            'requested' in (metadata.genericNodeOverride as Record<string, unknown>)
              ? {
                  genericNodeOverride:
                    metadata.genericNodeOverride as JaafarAutomationGraphInput['genericNodeOverride'],
                }
              : {}),
            lastFailure: {
              stage: retryFrom === 'provision' ? ('provision' as const) : ('test' as const),
              message: run.error ?? 'Retry requested after failure',
              code: 'UNKNOWN',
            },
          },
        },
        this.graphConfig(
          runId,
          {
            userId: scope?.userId ?? run.userId ?? undefined,
            organizationId: scope?.organizationId ?? run.organizationId ?? undefined,
          },
          'retry',
        ),
      );
      return this.result(runId, result, 'COMPLETED');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation retry failed';
      await this.failRun(runId, message);
      throw error;
    }
  }

  build() {
    return new StateGraph(AutomationGraphState)
      .addNode('understand', async (state) => {
        if (state.input.understanding) {
          await this.recordUnderstanding(state.input.runId, state.input.understanding);
          return { understanding: state.input.understanding };
        }
        const loaded = await this.contextLoader.load({
          agentId: state.input.agentId,
          userMessage: state.input.userMessage,
          conversationId: state.input.conversationId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
          mode: 'planning',
        });
        let understanding: RequestUnderstandingResult;
        try {
          understanding = await this.understandingService.understand({
            userMessage: state.input.userMessage,
            history: loaded.history,
            agentName: loaded.agent.name,
            agentInstructions: loaded.agent.instructions,
            memoryReferences: loaded.memoryReferences,
            knowledgeReferences: loaded.knowledgeReferences,
            effort: state.input.effort,
            ...(state.input.pendingContext ? { pendingContext: state.input.pendingContext } : {}),
          });
        } catch (error) {
          // Persist the failure diagnostic before the run fails — without
          // this, structured-output failures are undebuggable (no raw
          // sample, no classification, no finish reason anywhere).
          await this.recordUnderstandingFailure(state.input.runId, error);
          throw error;
        }
        await this.recordUnderstanding(state.input.runId, understanding);
        await this.recordUsage(state.input.runId, understanding.modelCall.usage);
        return {
          understanding,
          usage: understanding.modelCall.usage,
        };
      })
      .addNode('plan', async (state) => {
        if (!state.understanding) throw new Error('Planning requires understanding');
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.PLANNING,
          reason: 'request understood — planning automation',
        });
        const [planContext, capabilities, instance] = await Promise.all([
          this.contextManager.buildForStage({
            stage: 'PLANNING',
            agentId: state.input.agentId,
            userMessage: state.input.userMessage,
            conversationId: state.input.conversationId,
            userId: state.input.userId,
            organizationId: state.input.organizationId,
          }),
          this.registry
            .capabilitiesForScope({
              userId: state.input.userId,
              organizationId: state.input.organizationId,
            })
            .catch(() => []),
          this.loadInstance(state.input).catch(() => null),
        ]);
        let result: Awaited<ReturnType<LLMRuntimeService['generateObject']>>;
        try {
          result = await this.generateBlueprint(state, planContext, capabilities, instance);
        } catch (error) {
          // One self-correction pass at higher effort before failing the
          // design (mirrors the understanding service): a flaky
          // structured-output generation must not kill the whole run. The raw
          // failure is fed back so the model repairs its own output shape.
          const firstFailure = error instanceof Error ? error.message : String(error);
          try {
            result = await this.generateBlueprint(
              state,
              planContext,
              capabilities,
              instance,
              firstFailure,
            );
          } catch (correctiveError) {
            await this.recordPlanFailure(state.input.runId, correctiveError);
            const detail =
              correctiveError instanceof Error ? correctiveError.message : String(correctiveError);
            // Mark truncation in the message itself: the humanizer downstream
            // only sees this string, not the structured error details.
            throw new Error(
              `plan generation failed${isTruncatedGeneration(correctiveError) ? ' (output truncated)' : ''}: ${detail}`,
            );
          }
        }
        const blueprint = automationBlueprintSchema.parse(result.object);
        await this.recordUsage(state.input.runId, result.usage);
        return {
          blueprint,
          planAttempts: state.planAttempts + 1,
          // Clear any prior-round feedback — presence of feedback routes back here.
          planFeedback: undefined,
          clarificationOverride: undefined,
          usage: result.usage,
        };
      })
      .addNode('review_plan', async (state) => {
        if (!state.blueprint || !state.understanding) {
          throw new Error('Plan review requires a blueprint and understanding');
        }
        const capabilities = await this.registry
          .capabilitiesForScope({
            userId: state.input.userId,
            organizationId: state.input.organizationId,
          })
          .catch(() => undefined);
        const instance = await this.loadInstance(state.input).catch(() => null);
        const reviewed = this.planReview.review({
          blueprint: state.blueprint,
          requirements: state.understanding.requirements,
          conditions: state.understanding.conditions,
          ...(capabilities ? { capabilities } : {}),
          ...(instance ? { instanceNodeTypes: instance.nodeTypes.map((node) => node.type) } : {}),
          ...((state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride)
            ? {
                genericOverride:
                  state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride,
              }
            : {}),
        });
        // Credential independence: known-but-disconnected providers are
        // warnings (CREDENTIAL_REQUIRED), never errors — the graph continues
        // to build. Only genuinely UNKNOWN integrations block here.
        if (!reviewed.valid) {
          // Persist the rejected plan + defects before replanning or
          // failing — otherwise nobody can ever see WHAT the model emitted
          // (e.g. steps without requirementIds) and the loop is undebuggable.
          await this.agentRuns.recordArtifacts(
            state.input.runId,
            {
              automationPlan: reviewed.blueprint as never,
              validationResult: {
                valid: false,
                errors: reviewed.errors,
                warnings: reviewed.warnings,
                coverage: reviewed.coverage,
              } as never,
            },
            'plan review failed',
          );
          // Unknown provider and nothing else: asking the user to clarify
          // beats burning the replan budget on an unfixable plan. The invalid
          // names never reach the builder. Placeholder-ish values (PENDING,
          // TODO, "X (must be connected)") are model formatting failures,
          // not real providers — those go back for a replan.
          const unknownIntegrations = reviewed.errors.filter(
            (e) => e.code === 'UNKNOWN_INTEGRATION',
          );
          const names = [
            ...new Set(
              unknownIntegrations.map(
                (e) => e.message.match(/"([^"]+)"/)?.[1] ?? 'the required integration',
              ),
            ),
          ];
          const placeholders = names.filter((name) => this.isPlaceholderIntegrationName(name));
          if (placeholders.length > 0) {
            if (state.planAttempts >= MAX_PLAN_ATTEMPTS) {
              throw new Error(
                `Automation plan keeps inventing integrations (${placeholders.join(', ')}) instead of using connected provider keys`,
              );
            }
            return {
              blueprint: reviewed.blueprint,
              planFeedback:
                `Your previous plan was rejected:\n` +
                `- Do NOT use placeholder integration names like ${placeholders.join(', ')}. ` +
                `step[].integration must be an EXACT provider key from the connected list, or omitted for structural steps.\n` +
                `Fix every issue and return the complete corrected blueprint.`,
            };
          }
          if (
            unknownIntegrations.length > 0 &&
            unknownIntegrations.length === reviewed.errors.length
          ) {
            const nameList =
              names.length > 1
                ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
                : (names[0] ?? 'the required integration');
            return {
              blueprint: reviewed.blueprint,
              planFeedback: undefined,
              clarificationOverride:
                `"${state.blueprint.name}" refers to ${nameList}, which isn't a supported provider I can build. ` +
                `Tell me which connected tool to use instead (or the exact provider you mean) and I'll continue the design.`,
            };
          }
          if (state.planAttempts >= MAX_PLAN_ATTEMPTS) {
            const details = reviewed.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
            throw new Error(`Automation plan failed review twice: ${details}`);
          }
          return {
            blueprint: reviewed.blueprint,
            planFeedback: `Your previous plan was rejected:\n${reviewed.errors.map((e) => `- ${e.message}`).join('\n')}${this.relevantWarningsFeedback(reviewed.warnings)}\nFix every issue and return the complete corrected blueprint.`,
          };
        }
        await this.agentRuns.recordArtifacts(
          state.input.runId,
          { automationPlan: reviewed.blueprint as never },
          'automation plan reviewed',
        );
        // Structurally valid but admittedly incomplete: ask for what's
        // missing instead of sending a half-design to approval. Requirements
        // the user already answered (in understanding or the pending reply)
        // are filtered out so Jaafar never re-asks them; remaining items are
        // rendered as human-readable questions — never raw R-ids.
        if (!reviewed.blueprint.ready || reviewed.blueprint.missingRequirements.length > 0) {
          const unanswered = await this.unansweredMissingRequirements(
            state,
            reviewed.blueprint.missingRequirements,
          );
          if (unanswered.length === 0) {
            return { blueprint: reviewed.blueprint };
          }
          // Identity-prompt contract: at most TWO questions per response.
          // Required items first; the rest are summarized, not hidden.
          const prioritized = unanswered
            .slice()
            .sort(
              (a, b) =>
                this.missingRequirementWeight(state, b) - this.missingRequirementWeight(state, a),
            )
            .slice(0, 2);
          const overflow = unanswered.length - prioritized.length;
          return {
            blueprint: reviewed.blueprint,
            planFeedback: undefined,
            clarificationOverride:
              `I need a little more information before I can prepare the automation design:\n` +
              prioritized
                .map((item) => `- ${this.describeMissingRequirement(state, item)}`)
                .join('\n') +
              (overflow > 0
                ? `\n(+${overflow} more detail${overflow === 1 ? '' : 's'} we can settle after these.)`
                : ''),
          };
        }
        return { blueprint: reviewed.blueprint };
      })
      .addNode('build', () => {
        // Passthrough: BUILDING is entered only after static validation
        // passes (see static_validate) so a rejected plan can replan back
        // to PLANNING without an invalid BUILDING → PLANNING transition.
        // The node itself stays: edges and phase-progress tokens key on it.
        return {};
      })
      .addNode('static_validate', async (state) => {
        if (!state.blueprint || !state.understanding) {
          throw new Error('Static validation requires a reviewed blueprint');
        }
        const capabilities = await this.registry
          .capabilitiesForScope({
            userId: state.input.userId,
            organizationId: state.input.organizationId,
          })
          .catch(() => undefined);
        const validation = await this.builder.validateOnly({
          blueprint: state.blueprint,
          scope: { userId: state.input.userId, organizationId: state.input.organizationId },
          runId: state.input.runId,
          requirements: state.understanding.requirements,
          conditions: state.understanding.conditions,
          ...(capabilities ? { capabilities } : {}),
          ...((state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride)
            ? {
                genericOverride:
                  state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride,
              }
            : {}),
        });
        if (!validation.valid) {
          const details = validation.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
          // Persist the diagnostics before replanning or failing — a run
          // must never lose the validation result that rejected its plan.
          await this.agentRuns.recordArtifacts(
            state.input.runId,
            {
              validationResult: {
                valid: false,
                errors: validation.errors,
                warnings: validation.warnings,
                coverage: validation.coverage,
              } as never,
            },
            'static validation failed',
          );
          // Fixable statically-rejected plans loop back into planning with the
          // exact defects (§15: fix plan → validate again) while budget
          // remains; only the truly unfixable throw.
          if (state.planAttempts >= MAX_PLAN_ATTEMPTS) {
            throw new Error(`Automation failed static validation: ${details}`);
          }
          return {
            planFeedback:
              `Your previous plan failed STATIC validation (it was never built):\n` +
              `${validation.errors.map((e) => `- ${e.message}`).join('\n')}` +
              `${this.relevantWarningsFeedback(validation.warnings)}\n` +
              `Fix every issue — use exact provider keys, machine-readable trigger config, balanced {{ }} expressions, and reference earlier steps by plan name — and return the complete corrected blueprint.`,
          };
        }
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.STATIC_VALIDATION,
          reason: 'workflow passed static validation',
        });
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.BUILDING,
          reason: 'validated plan — building workflow',
        });
        return {};
      })
      .addNode('await_approval', async (state) => {
        if (!state.blueprint) throw new Error('Approval requires a validated blueprint');
        // Park the row as WAITING BEFORE the interrupt fires: if the SSE
        // client disconnects on the wait event and never pulls the generator
        // again, the run must already be WAITING — otherwise resume() would
        // refuse the later approval ("no longer waiting").
        await this.agentRuns.advance(state.input.runId, {
          toStatus: 'WAITING',
          reason: 'automation awaiting approval',
        });
        const revision = blueprintRevision(state.blueprint);
        // Mark the approval gate on the run row so a later chat message
        // ("ok i approve") can be routed to resume() instead of starting a
        // fresh design — the interrupt payload alone is invisible to the
        // next turn's classifier.
        try {
          await this.runs.updateMetadata(state.input.runId, {
            approvalPending: true,
            approvalGate: 'design_approval',
            approvalSummary: this.formatApprovalSummary(state.blueprint),
            approvalRevision: revision,
          });
        } catch {
          /* best-effort: the WAITING advance above already parked the run */
        }
        interrupt({
          type: 'automation_design_approval',
          runId: state.input.runId,
          blueprintRevision: revision,
          blueprint: {
            name: state.blueprint.name,
            goal: state.blueprint.goal,
            trigger: state.blueprint.trigger.type,
            steps: state.blueprint.steps.map((step) => ({
              name: step.name,
              action: step.action,
              ...(step.integration ? { integration: step.integration } : {}),
              ...(step.nodeHint
                ? {
                    nodeType: step.nodeHint.type,
                    ...(step.nodeHint.nodeChoiceReason
                      ? { nodeChoiceReason: step.nodeHint.nodeChoiceReason }
                      : {}),
                  }
                : {}),
            })),
          },
        });
        return {};
      })
      .addNode('provision', async (state) => {
        const blueprint = this.blueprintOf(state);
        if (!blueprint) {
          throw new Error('Provisioning requires a validated blueprint');
        }
        // Plan-only mode: with no ACTIVE n8n connection there is nowhere to
        // provision. Save the validated plan as a draft (run stays WAITING)
        // instead of failing — the user can connect n8n later and provision
        // the exact plan via provisionDeferred() without replanning.
        const hasConnection = await this.hasActiveConnection(state.input);
        if (!hasConnection && !state.automationId && !state.input.automationId) {
          await this.agentRuns.recordArtifacts(
            state.input.runId,
            {
              automationPlan: blueprint as never,
              ...(this.requirementsOf(state)
                ? { requirements: this.requirementsOf(state) as never }
                : {}),
              ...(this.conditionsOf(state)
                ? { conditions: this.conditionsOf(state) as never }
                : {}),
            },
            'automation plan saved as draft (no n8n connection)',
          );
          await this.agentRuns.advance(state.input.runId, {
            toStatus: 'WAITING',
            reason: 'n8n connection required — plan saved as draft',
          });
          try {
            await this.runs.updateMetadata(state.input.runId, {
              buildDeferred: true,
              // The checkpoint is past the approval interrupt (provision ran
              // and parked at the deferral gate) — a later chat "ok" must NOT
              // route here as a design approval; the draft provisions via
              // provisionDeferred() instead.
              approvalPending: false,
              approvalGate: 'deferred',
              userMessage: state.input.userMessage,
              intent: 'automation_design',
              // The deferred build must honor an explicit generic-node override
              // — the understanding is not hydrated on provisionDeferred().
              ...((state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride)
                ? {
                    genericNodeOverride:
                      state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride,
                  }
                : {}),
            });
          } catch {
            /* best-effort */
          }
          return { deferred: true as const, waitingReason: 'clarification' as const };
        }
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.EXECUTING,
          toStatus: 'EXECUTING',
          reason: state.automationId
            ? 'repair approved — re-provisioning automation'
            : 'design approved — provisioning automation',
        });
        const capabilities = await this.registry
          .capabilitiesForScope({
            userId: state.input.userId,
            organizationId: state.input.organizationId,
          })
          .catch(() => undefined);
        const built = await this.builder.build({
          blueprint,
          scope: { userId: state.input.userId, organizationId: state.input.organizationId },
          runId: state.input.runId,
          requirements: this.requirementsOf(state),
          conditions: this.conditionsOf(state),
          ...(capabilities ? { capabilities } : {}),
          ...((state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride)
            ? {
                genericOverride:
                  state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride,
              }
            : {}),
          ...((state.automationId ?? state.input.automationId)
            ? { automationId: (state.automationId ?? state.input.automationId) as string }
            : {}),
        });
        return {
          automationId: built.automation.id,
          externalWorkflowId: built.automation.externalWorkflowId,
          webhookPath: built.automation.webhookPath,
          buildable: built.automation.buildable,
          readyToRun: built.automation.readyToRun,
          readinessBlockers: built.automation
            .readinessBlockers as AutomationGraphState['readinessBlockers'],
        };
      })
      .addNode('defer_build', async (state) => {
        const name = state.blueprint?.name ?? state.input.blueprint?.name ?? 'Automation';
        const response =
          `Your automation plan "${name}" is ready and validated, and I've saved it as a draft. ` +
          `I haven't created it in n8n yet because no n8n instance is connected. ` +
          `Connect your n8n instance and tell me to build it — I'll provision this exact plan with no redesign needed.`;
        if (state.input.conversationId) {
          try {
            await this.conversations.addMessage(state.input.conversationId, {
              role: 'assistant',
              content: response,
            });
          } catch {
            /* best-effort: the run result still carries the response */
          }
        }
        return { response };
      })
      .addNode('verify', async (state) => {
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.RUNTIME_VALIDATION,
          reason: 'provisioned — verifying in n8n',
        });
        const verification = await this.verifyProvisioned(state);
        if (!verification.ok) {
          return {
            verifyOk: false as const,
            lastFailure: {
              stage: 'verify' as const,
              message: verification.message,
              code: 'API_ERROR',
            },
          };
        }
        return { verifyOk: true as const, verifySkipped: verification.skipped === true };
      })
      .addNode('test_execute', async (state) => {
        const blueprint = state.blueprint ?? state.input.blueprint;
        if (!blueprint) throw new Error('Test execution requires a blueprint');
        // Credential independence: a built-but-not-ready workflow is a
        // successful build. Skip live execution — it would fail on missing
        // provider auth — and let `complete` report readiness instead.
        if (state.readyToRun === false) {
          await this.agentRuns.recordArtifacts(
            state.input.runId,
            {
              executionResults: {
                automationId: state.automationId ?? state.input.automationId ?? null,
                externalWorkflowId:
                  state.externalWorkflowId ?? state.input.externalWorkflowId ?? null,
                webhookPath: state.webhookPath ?? state.input.webhookPath ?? null,
                testPassed: false,
                testSkipped: true,
                testSkipReason: 'CREDENTIALS_REQUIRED',
                buildable: state.buildable ?? true,
                readyToRun: false,
                readinessBlockers: (state.readinessBlockers ?? []) as never,
              } as never,
            },
            'runtime validation skipped (credentials required)',
          );
          return { testOk: true as const };
        }
        const connection = await this.resolveConnection(state.input);
        const webhookPath = state.webhookPath ?? state.input.webhookPath ?? undefined;
        if (!connection) {
          return {
            testOk: false as const,
            lastFailure: {
              stage: 'test' as const,
              message:
                'No ACTIVE n8n connection is available to execute the automation against — reconnect the client instance first.',
              code: 'CREDENTIAL_ERROR',
            },
          };
        }
        if (!webhookPath) {
          // Distinct failure shape: the connection is fine — the built
          // workflow simply exposes nothing to execute. Classified as an
          // INVALID_CONFIGURATION so it can never masquerade as a credential
          // problem (the old collapsed check burned the repair budget on an
          // unfixable "fix credentials" loop).
          return {
            testOk: false as const,
            lastFailure: {
              stage: 'test' as const,
              message:
                'The built workflow exposes no webhook path, so runtime validation has nothing to execute against.',
              code: 'INVALID_CONFIGURATION',
            },
          };
        }
        const validated = await this.validator.validate({
          blueprint,
          baseUrl: connection.baseUrl,
          webhookPath,
          runId: state.input.runId,
          userId: state.input.userId,
          organizationId: state.input.organizationId,
        });
        await this.agentRuns.recordArtifacts(
          state.input.runId,
          {
            executionResults: {
              automationId: state.automationId ?? state.input.automationId ?? null,
              externalWorkflowId:
                state.externalWorkflowId ?? state.input.externalWorkflowId ?? null,
              webhookPath,
              testPassed: validated.ok,
              testChecks: validated.checks,
              testDurationMs: validated.durationMs,
            } as never,
          },
          validated.ok ? 'runtime validation passed' : 'runtime validation failed',
        );
        if (!validated.ok) {
          const firstFailing = validated.checks.find((check) => !check.passed);
          return {
            testOk: false as const,
            lastFailure: {
              stage: 'test' as const,
              message:
                firstFailing?.detail ??
                validated.classified?.summary ??
                'Runtime validation failed',
              code: validated.classified?.code ?? 'LOGIC_ERROR',
            },
          };
        }
        return { testOk: true as const };
      })
      .addNode('diagnose', async (state) => {
        const failure = state.lastFailure ?? state.input.lastFailure;
        if (!failure) throw new Error('Diagnosis requires a recorded failure');
        // Park in the repairable FAILED phase first — RUNTIME_VALIDATION has
        // no direct edge to DIAGNOSING, and FAILED→DIAGNOSING is the repair path.
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.FAILED,
          reason: `automation failed at ${failure.stage} — diagnosing`,
        });
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.DIAGNOSING,
          reason: `diagnosing ${failure.code} at ${failure.stage}`,
        });
        const classified = this.classifier.classify(
          { message: failure.message, code: failure.code },
          failure.stage,
        );
        const blueprint = state.blueprint ?? state.input.blueprint;
        if (!blueprint) throw new Error('Diagnosis requires the failed blueprint');
        if (classified.repairStrategy === 'retry_execution') {
          return {
            diagnosis: `${classified.summary} Classified as transient — retrying unchanged.`,
            repairChanges: [],
            retryUnchanged: true,
            nextStep:
              failure.stage === 'provision' ? ('provision' as const) : ('test_execute' as const),
          };
        }
        if (!this.repair.needsPatch(classified)) {
          // fix_credentials / escalate: only the user can unblock (reconnect
          // the instance, re-permission the key). Patching the blueprint can
          // never help — escalate immediately with the concrete user action
          // instead of burning the repair budget on a futile LLM patch loop.
          return { escalated: true as const };
        }
        const nextAttempt = (state.repairAttempt || state.input.repairAttempt || 0) + 1;
        if (nextAttempt > MAX_REPAIR_ATTEMPTS) {
          // Budget spent — the final patch was already provisioned and
          // re-tested. Escalate instead of requesting an out-of-budget patch.
          return { escalated: true as const };
        }
        const patched = await this.repair.diagnoseAndPatch({
          blueprint,
          failure: {
            stage: failure.stage,
            message: failure.message,
            classified,
          },
          requirements: state.understanding?.requirements ?? state.input.requirements ?? [],
          conditions: state.understanding?.conditions ?? state.input.conditions ?? [],
          attempt: (state.repairAttempt || state.input.repairAttempt || 0) + 1,
          effort: state.input.effort,
        });
        return {
          blueprint: patched.blueprint,
          diagnosis: patched.diagnosis,
          repairChanges: patched.changes,
          retryUnchanged: false,
          nextStep: 'provision' as const,
        };
      })
      .addNode('repair', async (state) => {
        const attempt = (state.repairAttempt || state.input.repairAttempt || 0) + 1;
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.REPAIRING,
          reason: `repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`,
        });
        const blueprint = state.blueprint ?? state.input.blueprint;
        if (!blueprint) throw new Error('Repair requires a blueprint');
        // Revalidate the patched blueprint here — the `provision` node owns
        // the actual re-provisioning, so a repair never provisions twice.
        // Unchanged retries skip validation (nothing changed).
        try {
          if (!state.retryUnchanged) {
            const capabilities = await this.registry
              .capabilitiesForScope({
                userId: state.input.userId,
                organizationId: state.input.organizationId,
              })
              .catch(() => undefined);
            const revalidation = await this.builder.validateOnly({
              blueprint,
              scope: { userId: state.input.userId, organizationId: state.input.organizationId },
              requirements: state.understanding?.requirements ?? state.input.requirements,
              conditions: state.understanding?.conditions ?? state.input.conditions,
              ...(capabilities ? { capabilities } : {}),
              ...((state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride)
                ? {
                    genericOverride:
                      state.understanding?.genericNodeOverride ?? state.input.genericNodeOverride,
                  }
                : {}),
            });
            if (!revalidation.valid) {
              const details = revalidation.errors.map((e) => `${e.code}: ${e.message}`).join('; ');
              throw new Error(`Repaired plan failed revalidation: ${details}`);
            }
          }
          await this.agentRuns.appendRepairAttempt(state.input.runId, {
            attempt,
            at: new Date().toISOString(),
            stage: state.lastFailure?.stage ?? state.input.lastFailure?.stage ?? 'test',
            code: state.lastFailure?.code ?? state.input.lastFailure?.code ?? 'UNKNOWN',
            diagnosis: state.diagnosis ?? 'transient failure — retrying unchanged',
            changes: state.repairChanges ?? [],
            blueprintRevision: blueprintRevision(blueprint),
          });
        } catch (error) {
          // A revalidation/reprovision failure is itself a repair outcome —
          // loop back into diagnosis while budget remains.
          const message = error instanceof Error ? error.message : String(error);
          await this.agentRuns.appendRepairAttempt(state.input.runId, {
            attempt,
            at: new Date().toISOString(),
            stage: 'validate',
            code: 'INVALID_CONFIGURATION',
            diagnosis: state.diagnosis ?? 'repair rejected',
            changes: state.repairChanges ?? [],
            blueprintRevision: blueprintRevision(blueprint),
          });
          return {
            repairAttempt: attempt,
            repairFailed: true as const,
            lastFailure: { stage: 'validate' as const, message, code: 'INVALID_CONFIGURATION' },
            // nextStep stays untouched: the revalidation failure routes back
            // into diagnose via repairFailed — never provision a blueprint
            // that just failed validation.
          };
        }
        return {
          repairAttempt: attempt,
          repairFailed: false as const,
          nextStep: state.nextStep ?? ('test_execute' as const),
        };
      })
      .addNode('complete', async (state) => {
        const blockers = state.readinessBlockers ?? [];
        const awaitingCredentials = state.readyToRun === false;
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.COMPLETED,
          toStatus: 'COMPLETED',
          reason: awaitingCredentials
            ? 'automation built but awaiting credentials'
            : 'automation tested and verified in n8n',
        });
        const attempts = state.repairAttempt || state.input.repairAttempt || 0;
        const automationName = state.blueprint?.name ?? state.input.blueprint?.name ?? 'Automation';
        const webhookSuffix =
          (state.webhookPath ?? state.input.webhookPath)
            ? ` (webhook: ${state.webhookPath ?? state.input.webhookPath})`
            : '';
        const missing = [...new Set(blockers.map((b) => b.integration))]
          .map((name) =>
            name
              .split(/[_-]+/)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' '),
          )
          .filter(Boolean);
        const missingList =
          missing.length > 1
            ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
            : (missing[0] ?? '');
        const response = awaitingCredentials
          ? `I've built "${automationName}"${webhookSuffix}. It is saved in your n8n instance but remains inactive — ${missingList || 'required credentials'} still need${missing.length === 1 ? 's' : ''} to be connected before it can run.`
          : state.verifySkipped
            ? `Automation "${automationName}" is now ACTIVE in your n8n instance${webhookSuffix}. ` +
              `It was statically validated and executed against test data, but I couldn't re-read it from your n8n instance to verify live (the connection was unavailable at verification time)` +
              `${attempts > 0 ? ` (after ${attempts} automatic repair${attempts === 1 ? '' : 's'})` : ''}.`
            : `Automation "${automationName}" is now ACTIVE in your n8n instance${webhookSuffix}. ` +
              `It was statically validated, executed against test data, and verified live` +
              `${attempts > 0 ? ` (after ${attempts} automatic repair${attempts === 1 ? '' : 's'})` : ''} — no success was reported before verification.`;
        if (state.input.conversationId) {
          await this.conversations.addMessage(state.input.conversationId, {
            role: 'assistant',
            content: response,
          });
        }
        return { response };
      })
      .addNode('escalate', async (state) => {
        const attempts = state.repairAttempt || state.input.repairAttempt || 0;
        await this.agentRuns.advance(state.input.runId, {
          toPhase: AGENT_RUN_PHASE.FAILED,
          toStatus: 'FAILED',
          reason:
            attempts >= MAX_REPAIR_ATTEMPTS
              ? `repair budget exhausted (${MAX_REPAIR_ATTEMPTS} attempts)`
              : 'automation failed — escalated to the user (user action required)',
        });
        const failure = state.lastFailure ??
          state.input.lastFailure ?? {
            stage: 'test' as const,
            message: 'Automation could not be completed',
            code: 'UNKNOWN',
          };
        const snapshot = await this.agentRuns.snapshot(state.input.runId);
        const attemptTrail = (snapshot.run.repairAttempts as unknown[] | null) ?? [];
        const message = this.repair.escalationMessage({
          automationName: state.blueprint?.name ?? state.input.blueprint?.name ?? 'your automation',
          succeeded: this.succeededSteps(state),
          failure: {
            stage: failure.stage,
            message: failure.message,
            classified: this.classifier.classify(
              { message: failure.message, code: failure.code },
              failure.stage,
            ),
          },
          attempts: attemptTrail as never,
        });
        if (state.input.conversationId) {
          await this.conversations.addMessage(state.input.conversationId, {
            role: 'assistant',
            content: message,
          });
        }
        return { response: message, escalated: true };
      })
      .addConditionalEdges(START, (state) => state.input.retryFrom ?? 'understand', {
        understand: 'understand',
        provision: 'provision',
        test_execute: 'test_execute',
        diagnose: 'diagnose',
      })
      .addNode('ask_clarification', async (state) => {
        const question =
          state.clarificationOverride ??
          state.understanding?.clarificationQuestion ??
          'What outcome would you like Jaafar to help you achieve?';
        await this.agentRuns.advance(state.input.runId, {
          toStatus: 'WAITING',
          reason: 'automation needs confirmation',
        });
        // Persist the question on the run row so the NEXT turn's
        // loadPendingContext() can carry it (plus prior intent) into the new
        // run — otherwise every follow-up answer starts from zero context and
        // Jaafar re-asks questions the user already answered.
        try {
          await this.runs.updateMetadata(state.input.runId, {
            clarificationQuestion: question,
            userMessage: state.input.userMessage,
            intent: 'automation_design',
          });
        } catch {
          /* best-effort: the conversation still shows the question */
        }
        if (state.input.conversationId) {
          await this.conversations.addMessage(state.input.conversationId, {
            role: 'assistant',
            content: question,
          });
        }
        return { response: question, waitingReason: 'clarification' as const };
      })
      .addConditionalEdges('understand', (state) => this.routeAfterUnderstanding(state), {
        clarification: 'ask_clarification',
        plan: 'plan',
      })
      .addEdge('ask_clarification', END)
      .addConditionalEdges('review_plan', (state) => this.routeAfterReview(state), {
        replan: 'plan',
        build: 'build',
        ask: 'ask_clarification',
      })
      .addEdge('plan', 'review_plan')
      .addEdge('build', 'static_validate')
      .addConditionalEdges(
        'static_validate',
        (state) => (state.planFeedback ? 'replan' : 'approval'),
        { replan: 'plan', approval: 'await_approval' },
      )
      .addEdge('await_approval', 'provision')
      .addConditionalEdges('provision', (state) => (state.deferred ? 'defer_build' : 'verify'), {
        verify: 'verify',
        defer_build: 'defer_build',
      })
      .addEdge('defer_build', END)
      .addConditionalEdges('verify', (state) => (state.verifyOk ? 'test' : 'diagnose'), {
        test: 'test_execute',
        diagnose: 'diagnose',
      })
      .addConditionalEdges('test_execute', (state) => (state.testOk ? 'complete' : 'diagnose'), {
        complete: 'complete',
        diagnose: 'diagnose',
      })
      .addConditionalEdges('diagnose', (state) => (state.escalated ? 'escalate' : 'repair'), {
        escalate: 'escalate',
        repair: 'repair',
      })
      .addConditionalEdges('repair', (state) => this.routeAfterRepair(state), {
        provision: 'provision',
        test_execute: 'test_execute',
        escalate: 'escalate',
        diagnose: 'diagnose',
      })
      .addEdge('complete', END)
      .addEdge('escalate', END)
      .compile({ checkpointer: this.checkpointer() });
  }

  graphConfig(
    runId: string,
    scope?: Pick<JaafarAutomationGraphInput, 'userId' | 'organizationId'>,
    threadSuffix?: string,
  ) {
    const thread = `jaafar:automation:${scope?.organizationId ?? 'personal'}:${scope?.userId ?? 'anonymous'}:${runId}${threadSuffix ? `:${threadSuffix}` : ''}`;
    return { configurable: { thread_id: thread } };
  }

  private blueprintOf(state: AutomationGraphState): AutomationBlueprint | undefined {
    return state.blueprint ?? state.input.blueprint;
  }

  private requirementsOf(
    state: AutomationGraphState,
  ): Array<{ id?: string; field: string; required: boolean }> | undefined {
    return state.understanding?.requirements ?? state.input.requirements;
  }

  private conditionsOf(state: AutomationGraphState): string[] | undefined {
    return state.understanding?.conditions ?? state.input.conditions;
  }

  // ── internals ──────────────────────────────────────────────

  private async ensureRun(input: JaafarAutomationGraphInput): Promise<string> {
    if (input.runId) {
      await this.runs.updateMetadata(input.runId, { automationV2: true });
      return input.runId;
    }
    const created = await this.agentRuns.createAgentRun({
      agentId: input.agentId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      metadata: {
        runtimeMode: 'automation_design',
        automationV2: true,
        userMessage: input.userMessage,
      },
    });
    return created.id;
  }

  private async failRun(runId: string, message: string): Promise<void> {
    try {
      // Every non-terminal phase can sink to FAILED (repairable — Phase 4
      // resumes from here). Terminal rows fall through to the legacy fail.
      await this.agentRuns.advance(runId, {
        toPhase: AGENT_RUN_PHASE.FAILED,
        toStatus: 'FAILED',
        reason: message.slice(0, 500),
      });
    } catch {
      try {
        await this.runs.fail(runId, message);
      } catch {
        /* best-effort */
      }
    }
  }

  private routeAfterUnderstanding(state: AutomationGraphState): 'clarification' | 'plan' {
    if (!state.understanding || state.understanding.route === 'clarification')
      return 'clarification';
    return 'plan';
  }

  /**
   * Drops blueprint missing-requirement entries the user already answered.
   * An R-id counts as answered when the matching understanding requirement
   * was explicitly provided by the user (source 'user' with a value) or its
   * value appears in the current reply OR in recent conversation history.
   * History matters: clarification answers arrive one turn at a time ("slack
   * dm"), and the NEXT turn's replan must not re-ask for them just because
   * the new reply ("why no successful result") doesn't repeat the value.
   * Anything else stays unanswered.
   */
  private async unansweredMissingRequirements(
    state: AutomationGraphState,
    missing: string[],
  ): Promise<string[]> {
    const requirements = state.understanding?.requirements ?? [];
    const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
    const corpus = await this.answerCorpus(state);
    return missing.filter((item) => {
      const match = item.trim().match(/^(R\d+)$/i);
      if (!match) return true;
      const requirement = byId.get(match[1]!.toUpperCase());
      if (!requirement) return true;
      if (requirement.source === 'user' && requirement.value?.trim()) return false;
      const value = requirement.value?.trim().toLowerCase();
      if (value && value.length > 1 && corpus.includes(value)) return false;
      return true;
    });
  }

  /** Current reply + recent scoped history, lowercased, for answer matching. */
  private async answerCorpus(state: AutomationGraphState): Promise<string> {
    const parts = [state.input.userMessage.toLowerCase()];
    if (state.input.conversationId) {
      try {
        const messages = await this.conversations.getMessages(
          state.input.conversationId,
          { take: 20, order: 'desc' },
          { userId: state.input.userId, organizationId: state.input.organizationId },
        );
        for (const message of messages) parts.push((message.content ?? '').toLowerCase());
      } catch {
        /* best-effort: reply-only matching still applies */
      }
    }
    return parts.join('\n');
  }

  /**
   * Renders one blueprint missing-requirement entry for the user. Bare
   * internal ids (R1, R2, …) are mapped back to the understanding
   * requirement's field/value; anything else passes through unchanged.
   */
  private describeMissingRequirement(state: AutomationGraphState, item: string): string {
    const match = item.trim().match(/^(R\d+)$/i);
    if (!match) return item;
    const requirement = (state.understanding?.requirements ?? []).find(
      (entry) => entry.id === match[1]!.toUpperCase(),
    );
    if (!requirement) return `Requirement ${match[1]!.toUpperCase()} — please describe it`;
    const detail = requirement.value?.trim() ? ` (you mentioned: ${requirement.value.trim()})` : '';
    return `${requirement.field}${detail}`;
  }

  /** Priority weight for clarification ordering — required items first. */
  private missingRequirementWeight(state: AutomationGraphState, item: string): number {
    const match = item.trim().match(/^(R\d+)$/i);
    if (!match) return 0;
    const requirement = (state.understanding?.requirements ?? []).find(
      (entry) => entry.id === match[1]!.toUpperCase(),
    );
    return requirement?.required ? 1 : 0;
  }

  private routeAfterReview(state: AutomationGraphState): 'replan' | 'build' | 'ask' {
    // review_plan either throws (unfixable), returns planFeedback (replan),
    // sets clarificationOverride (ask the user — missing connection or
    // missing requirements), or a clean blueprint (build). The plan node
    // clears feedback on every attempt, so presence reliably means
    // "rejected this round".
    if (state.clarificationOverride) return 'ask';
    return state.planFeedback ? 'replan' : 'build';
  }

  private routeAfterRepair(
    state: AutomationGraphState,
  ): 'provision' | 'test_execute' | 'escalate' | 'diagnose' {
    const attempts = state.repairAttempt || state.input.repairAttempt || 0;
    if (state.repairFailed) {
      // The patched blueprint failed its own revalidation. Loop back into
      // diagnosis while the budget remains; escalate once it is spent.
      return attempts >= MAX_REPAIR_ATTEMPTS ? 'escalate' : 'diagnose';
    }
    // Off-by-one guard: MAX_REPAIR_ATTEMPTS is the number of repairs the run
    // may actually perform. `attempts >= MAX` here would compute, validate,
    // and journal the third (MAX) patch — then throw it away unprovisioned.
    if (attempts > MAX_REPAIR_ATTEMPTS) return 'escalate';
    return state.nextStep ?? 'test_execute';
  }

  /**
   * Placeholder-ish "integration" names are model formatting failures, not
   * real providers — asking the user to "connect PENDING" would be absurd.
   */
  /**
   * Native-preference warnings worth feeding back into a replan (e.g. prefer
   * the native node while availability is unproven). Other warnings stay out
   * of the feedback so replan loops are never triggered by unprovable hints.
   */
  private relevantWarningsFeedback(
    warnings: Array<{ code: string; message: string; stepId?: string }>,
  ): string {
    const relevant = warnings.filter(
      (warning) =>
        warning.code === 'UNMAPPED_STEP' && /native node|HTTP Request|Code/i.test(warning.message),
    );
    if (relevant.length === 0) return '';
    return `\nAlso address these warnings:\n${relevant.map((warning) => `- ${warning.message}`).join('\n')}`;
  }

  private isPlaceholderIntegrationName(name: string): boolean {
    return (
      /^(pending|todo|tbd|tba|n\/a|none|unknown|unspecified|required|needed|various)$/i.test(
        name.trim(),
      ) || /[\s()]/.test(name)
    );
  }

  private succeededSteps(state: AutomationGraphState): string[] {
    const done: string[] = ['Request understood', 'Plan reviewed', 'Workflow statically validated'];
    if (state.automationId ?? state.input.automationId) done.push('Provisioned in n8n');
    if (state.verifyOk) {
      done.push(
        state.verifySkipped
          ? 'Workflow provisioned (live verification skipped)'
          : 'Provisioning verified live',
      );
    }
    if (state.testOk) done.push('Test execution passed');
    return done;
  }

  /**
   * Persists a structured-output failure diagnostic into run metadata so the
   * next debug answers empty/malformed/schema-invalid/truncated directly.
   * Best-effort: never masks the original failure. Invalid understanding
   * still never reaches the planner — the error is rethrown.
   */
  private async recordUnderstandingFailure(runId: string, error: unknown): Promise<void> {
    try {
      const structured =
        error && typeof error === 'object' && 'kind' in error
          ? (error as { kind?: unknown; details?: { rawSample?: unknown; finishReason?: unknown } })
          : null;
      const kind = typeof structured?.kind === 'string' ? structured.kind : 'MODEL_REQUEST_FAILED';
      const rawSample =
        typeof structured?.details?.rawSample === 'string' ? structured.details.rawSample : '';
      const finishReason =
        typeof structured?.details?.finishReason === 'string'
          ? structured.details.finishReason
          : 'unknown';
      await this.runs.updateMetadata(runId, {
        understandingFailure: {
          kind,
          rawSample,
          finishReason,
          message:
            error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          at: new Date().toISOString(),
        },
      });
    } catch {
      /* best-effort */
    }
  }

  private async recordUnderstanding(runId: string, understanding: RequestUnderstandingResult) {
    await this.agentRuns.recordArtifacts(
      runId,
      {
        businessContext: understanding.businessContext as never,
        requirements: understanding.requirements as never,
        assumptions: understanding.assumptions as never,
        constraints: understanding.constraints as never,
      },
      'request understood',
    );
  }

  private async recordUsage(
    runId: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ) {
    try {
      await this.runs.recordModelUsage(runId, usage);
    } catch {
      /* best-effort */
    }
  }

  private async loadInstance(
    input: JaafarAutomationGraphInput,
  ): Promise<N8nInstanceInventory | null> {
    try {
      const credentials = await this.n8nConnections?.resolveActiveForScope({
        userId: input.userId,
        organizationId: input.organizationId,
      });
      if (!credentials || !this.nodeInventory) return null;
      return await this.nodeInventory.inventory({
        baseUrl: credentials.baseUrl,
        apiKey: credentials.apiKey,
      });
    } catch {
      return null;
    }
  }

  /**
   * True when the owner has an ACTIVE n8n connection right now. Missing or
   * unreadable connections count as absent — provisioning must defer, never
   * fail, so the validated plan survives as a draft.
   */
  private async hasActiveConnection(input: JaafarAutomationGraphInput): Promise<boolean> {
    try {
      const resolved = await this.n8nConnections?.resolveActiveForScope({
        userId: input.userId,
        organizationId: input.organizationId,
      });
      return Boolean(resolved);
    } catch {
      return false;
    }
  }

  private async resolveConnection(
    input: JaafarAutomationGraphInput,
  ): Promise<N8nClientConnection | null> {
    try {
      const resolved = await this.n8nConnections?.resolveActiveForScope({
        userId: input.userId,
        organizationId: input.organizationId,
      });
      if (!resolved) return null;
      return { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
    } catch {
      return null;
    }
  }

  /**
   * Blueprint generation with one built-in self-correction. The first pass
   * runs at the requested effort; a generation failure (empty output,
   * malformed JSON, schema mismatch, truncation) triggers exactly one
   * corrective pass at high effort with a larger budget and the raw failure
   * fed back — mirroring the understanding service's correction pattern.
   */
  private generateBlueprint(
    state: AutomationGraphState,
    planContext: StageContext,
    capabilities: Array<{
      displayName: string;
      connectionStatus: string;
      credentialType?: string;
      provider?: string;
      suggestedNodeType?: string;
    }>,
    instance: N8nInstanceInventory | null,
    priorFailure?: string,
  ): Promise<Awaited<ReturnType<LLMRuntimeService['generateObject']>>> {
    const corrective = priorFailure !== undefined;
    return this.llmRuntime.generateObject({
      mode: corrective ? 'high' : (state.input.effort ?? 'medium'),
      systemPrompt: this.planSystemPrompt(
        planContext,
        capabilities,
        instance,
        state,
        this.relevantNodeTypes(state.understanding, capabilities, instance),
      ),
      messages: [
        {
          role: 'user',
          content: this.planUserPrompt(
            state.understanding!,
            state.planFeedback,
            corrective ? this.planGenerationFailureHint(priorFailure) : undefined,
          ),
        },
      ],
      schema: automationBlueprintSchema,
      temperature: 0.2,
      // Corrective pass gets a larger budget: truncation is a common
      // first-pass failure for blueprints with node hints, and retrying with
      // the same budget would fail the same way.
      maxTokens: corrective ? 6000 : 4000,
      timeoutMs: corrective ? 120_000 : 90_000,
    });
  }

  /**
   * Feedback text for the corrective blueprint pass. Truncation gets
   * different guidance than schema errors: re-emitting the same shape fails
   * the same way, so the model is told to compact rather than repeat.
   */
  private planGenerationFailureHint(priorFailure: string): string {
    if (isTruncatedGeneration(priorFailure)) {
      return (
        `Your previous blueprint response was CUT OFF before completion (${priorFailure}). ` +
        `Regenerate the COMPLETE blueprint in a more compact form: keep every required step, ` +
        `but shorten long strings and nodeHint parameters. Never emit a partial blueprint.`
      );
    }
    return (
      `Your previous blueprint response failed validation and was discarded (${priorFailure}). ` +
      `Regenerate the COMPLETE blueprint, fixing the reported problem. ` +
      `Keep every step, requirementIds coverage, and nodeHint.`
    );
  }

  /**
   * Persists a plan-generation failure diagnostic into run metadata so the
   * next debug answers empty/malformed/schema-invalid/truncated directly.
   * Best-effort: never masks the original failure.
   */
  private async recordPlanFailure(runId: string, error: unknown): Promise<void> {
    try {
      const structured =
        error && typeof error === 'object' && 'kind' in error
          ? (error as { kind?: unknown; details?: { rawSample?: unknown; finishReason?: unknown } })
          : null;
      const kind = typeof structured?.kind === 'string' ? structured.kind : 'MODEL_REQUEST_FAILED';
      const rawSample =
        typeof structured?.details?.rawSample === 'string' ? structured.details.rawSample : '';
      const finishReason =
        typeof structured?.details?.finishReason === 'string'
          ? structured.details.finishReason
          : 'unknown';
      await this.runs.updateMetadata(runId, {
        planFailure: {
          kind,
          rawSample,
          finishReason,
          truncated: isTruncatedGeneration(error),
          message:
            error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          at: new Date().toISOString(),
        },
      });
    } catch {
      /* best-effort */
    }
  }

  private planSystemPrompt(
    planContext: StageContext,
    capabilities: Array<{
      displayName: string;
      connectionStatus: string;
      credentialType?: string;
      provider?: string;
      suggestedNodeType?: string;
    }>,
    instance: N8nInstanceInventory | null,
    state: AutomationGraphState,
    relevantTypes?: string[],
  ): string {
    const capabilityLines = capabilities.map(
      (capability) =>
        `- ${capability.displayName} [${capability.connectionStatus}]${capability.credentialType ? ` <${capability.credentialType}>` : ''}${capability.suggestedNodeType ? ` → prefer ${capability.suggestedNodeType}` : ''}`,
    );
    const byType = new Map((instance?.nodeTypes ?? []).map((node) => [node.type, node]));
    const listedTypes =
      relevantTypes && relevantTypes.length > 0
        ? relevantTypes
        : (instance?.nodeTypes ?? []).slice(0, 60).map((node) => node.type);
    const nodeLines = listedTypes.map((type) => {
      const node = byType.get(type);
      const version = node?.typeVersion !== undefined ? ` v${node.typeVersion}` : '';
      const creds =
        node?.credentials && Object.keys(node.credentials).length > 0
          ? ` [credentials: ${Object.keys(node.credentials).join(', ')}]`
          : '';
      // Honest availability labels: a node harvested from the owner's own
      // workflows is proven; one discovered via the node-types API is only
      // INSTALLED (credentials unknown); seeds are plumbing.
      const availability =
        node && node.inUse === false
          ? ' [installed, not yet used — verify at static validation]'
          : '';
      return `- ${type}${version}${creds}${availability}`;
    });
    return [
      'You are Jaafar designing a business automation as an n8n blueprint. Never guess — every step must trace to the request, and every integration must be a real, supported provider key.',
      "Return steps with stable requirementIds (R1, R2, …) matching the requirements below, explicit conditions for branches, and expectedOutput per step. Coverage is mandatory: EVERY requirement id must appear in at least one step's requirementIds — a step with an empty requirementIds is a defect, and an uncovered required requirement fails the plan.",
      'Set ready=false with missingRequirements ONLY when information is genuinely still needed — write each entry as its stable requirement id exactly (e.g. "R3", matching the requirementIds above). Jaafar renders them as readable questions; ids let it detect which ones you already had answered.',
      'Choose steps[].nodeHint = { type, typeVersion?, parameters, nodeChoiceReason? } using REAL node types from the instance list. Put concrete business values (message text, recipients, intervals, urls…) into parameters. Never invent credential names or ids.',
      "<node_selection_policy>Jaafar builds against the user's connected n8n instance, the source of truth for node availability. Priority: 1. Native integration node — if a compatible native node is listed below, prefer it. If the requested operation is verified as supported, MUST use it. If the operation is unverified, still prefer the native node and record nodeChoiceReason. 2. HTTP Request — only when no compatible native node is listed, when the native node is verified not to support the operation, or when the user explicitly requests direct HTTP/API usage (genericNodeOverride). 3. Code / Set / IF — only for transformation, logic, calculations, parsing, branching. NEVER as an integration substitute. Forbidden: HTTP Request for an integration with a listed compatible native node; Code calling an external API when a native or HTTP node fits. Do not assume a native exists because n8n generally supports the provider. Generic choices MUST include nodeChoiceReason. Missing provider credentials NEVER change node selection — still choose the native node; credentials are a runtime concern, not a design concern.</node_selection_policy>",
      'Name every step[].integration and blueprint integration with the EXACT provider key (e.g. "slack", "gmail", never "Slack channel" or "Slack (must be connected)"). Leave step[].integration EMPTY for structural steps (webhook, schedule, code, set, httpRequest, if, respond) and for generic HTTP calls — set it ONLY when the step calls a real third-party service. If the automation needs a supported integration that is NOT connected, KEEP it in the plan with its native node — do NOT omit, replace, or invent a different name for it. State the missing connection plainly in the summary instead; the workflow will be built anyway and marked as needing credentials.',
      'In n8n expressions reference earlier steps by their step NAME (e.g. {{$node["Receive order"].json}}), never by id. Keep every {{ }} balanced inside each string.',
      '<request_context>',
      this.contextManager.renderToPromptText(planContext),
      '</request_context>',
      '<connected_integrations>',
      capabilityLines.join('\n') || '(none connected)',
      '</connected_integrations>',
      '<client_n8n_node_types>',
      nodeLines.join('\n') ||
        '(instance not readable — prefer native nodes for known providers, verify at static validation)',
      '</client_n8n_node_types>',
      `<understanding>\n${JSON.stringify(state.understanding)}\n</understanding>`,
    ].join('\n\n');
  }

  /**
   * Relevant-node filtering for the planner (plan §6): natives matching
   * the request's entities/actions/conditions first, soft-capped so the
   * LLM sees ~20 targeted types instead of 60–80. Falls back to the raw
   * inventory order when the resolver is unavailable (spec-constructed).
   */
  private relevantNodeTypes(
    understanding: AutomationGraphState['understanding'],
    capabilities: Array<{
      provider?: string;
      suggestedNodeType?: string;
      nodeTypes?: string[];
    }>,
    instance: N8nInstanceInventory | null,
  ): string[] | undefined {
    if (!this.nodeResolver || !instance) return undefined;
    try {
      return this.nodeResolver.filterRelevantNodes({
        entities: understanding?.entities,
        actions: understanding?.actions,
        conditions: understanding?.conditions,
        instanceNodeTypes: instance.nodeTypes.map((node) => ({ type: node.type })),
        capabilities: (capabilities ?? []).map((capability) => ({
          provider: capability.provider ?? '',
          suggestedNodeType: capability.suggestedNodeType,
          nodeTypes: capability.nodeTypes,
        })),
      });
    } catch {
      return undefined;
    }
  }

  private planUserPrompt(
    understanding: JaafarUnderstanding,
    feedback?: string,
    priorFailure?: string,
  ): string {
    return [
      `<goal>${understanding.goal}</goal>`,
      `<trigger>${JSON.stringify(understanding.trigger)}</trigger>`,
      `<actions>${JSON.stringify(understanding.actions)}</actions>`,
      `<entities>${JSON.stringify(understanding.entities)}</entities>`,
      `<conditions>${JSON.stringify(understanding.conditions)}</conditions>`,
      `<constraints>${JSON.stringify(understanding.constraints)}</constraints>`,
      `<requirements>${JSON.stringify(understanding.requirements)}</requirements>`,
      `<assumptions>${JSON.stringify(understanding.assumptions)}</assumptions>`,
      feedback ? `<prior_plan_feedback>\n${feedback}\n</prior_plan_feedback>` : '',
      priorFailure ? `<prior_failure>\n${priorFailure}\n</prior_failure>` : '',
      'Return the complete automation blueprint now.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async verifyProvisioned(state: AutomationGraphState): Promise<{
    ok: boolean;
    message: string;
    webhookPath?: string;
    nodeCount?: number;
    /** True when verification could not run live (no connection). */
    skipped?: boolean;
  }> {
    const externalWorkflowId = state.externalWorkflowId ?? state.input.externalWorkflowId;
    if (!externalWorkflowId) {
      return { ok: false, message: 'Provisioned workflow id is missing' };
    }
    let connection: N8nClientConnection | null = null;
    try {
      const resolved = await this.n8nConnections?.resolveActiveForScope({
        userId: state.input.userId,
        organizationId: state.input.organizationId,
      });
      if (resolved) connection = { baseUrl: resolved.baseUrl, apiKey: resolved.apiKey };
    } catch {
      connection = null;
    }
    if (!connection) {
      // No live connection to verify against — the provisioner already
      // activated the workflow; record that verification was skipped.
      await this.agentRuns.recordArtifacts(
        state.input.runId,
        { executionResults: { verified: false, reason: 'no live connection' } as never },
        'verification skipped (no connection)',
      );
      return {
        ok: true,
        message: 'provisioned (live verification skipped — no connection)',
        skipped: true,
      };
    }
    try {
      const detail = await this.clientApi.getWorkflow(connection, externalWorkflowId);
      const nodes = detail.nodes ?? [];
      if (nodes.length === 0) {
        return { ok: false, message: 'Provisioned workflow came back with no nodes' };
      }
      const hooks = N8nClientApiService.extractWebhookPaths(detail);
      await this.agentRuns.recordArtifacts(
        state.input.runId,
        {
          executionResults: {
            verified: true,
            nodeCount: nodes.length,
            webhookPath: hooks[0]?.path,
          } as never,
        },
        'automation verified live in n8n',
      );
      return {
        ok: true,
        message: 'verified',
        webhookPath: hooks[0]?.path,
        nodeCount: nodes.length,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Provisioned workflow could not be read back: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private mapStreamUpdate(
    runId: string,
    update: Record<string, unknown>,
  ): AutomationGraphStreamEvent[] {
    const events: AutomationGraphStreamEvent[] = [];
    if ('__interrupt__' in update) {
      // The interrupt payload carries the blueprint for review — render it
      // as content so stream clients show the design, not just a wait state.
      // Defensive: any shape surprise falls back to the bare wait event.
      let summary = '';
      let approvalCard: {
        blueprintName?: string;
        blueprintGoal?: string;
        triggerType?: string;
        stepCount?: number;
        blueprintRevision?: string;
        summary?: string;
      } = {};
      try {
        const raw = update.__interrupt__ as Array<{ value?: unknown }> | { value?: unknown };
        const interrupts = Array.isArray(raw) ? raw : [raw];
        const found = interrupts
          .map((item) => item?.value)
          .find((value) => value && typeof value === 'object') as
          | {
              blueprint?: AutomationBlueprint;
              blueprintRevision?: string;
            }
          | undefined;
        summary = this.formatApprovalSummary(found?.blueprint);
        const card = found?.blueprint as
          | {
              name?: string;
              goal?: string;
              trigger?: { type?: string } | string;
              steps?: unknown[];
            }
          | undefined;
        const triggerType = typeof card?.trigger === 'string' ? card.trigger : card?.trigger?.type;
        approvalCard = {
          ...(card?.name ? { blueprintName: card.name } : {}),
          ...(card?.goal ? { blueprintGoal: card.goal } : {}),
          ...(triggerType ? { triggerType } : {}),
          ...(Array.isArray(card?.steps) ? { stepCount: card.steps.length } : {}),
          ...(typeof found?.blueprintRevision === 'string'
            ? { blueprintRevision: found.blueprintRevision }
            : {}),
          ...(summary ? { summary } : {}),
        };
        if (summary) events.push({ type: 'token', runId, content: summary });
      } catch {
        /* bare run.waiting below */
      }
      events.push({
        type: 'approval.required',
        runId,
        reason: 'automation_design_approval',
        ...approvalCard,
      });
      events.push({ type: 'run.waiting', runId, reason: 'approval' });
      return events;
    }
    for (const [node, value] of Object.entries(update)) {
      const state = (value ?? {}) as Record<string, unknown>;
      if (node === 'understand' && state.understanding) {
        events.push({ type: 'token', runId, content: 'Understanding your request ✓\n' });
      } else if (node === 'plan') {
        events.push({ type: 'token', runId, content: 'Planning the automation ✓\n' });
      } else if (node === 'review_plan' && !state.planFeedback) {
        events.push({ type: 'token', runId, content: 'Plan reviewed ✓\n' });
      } else if (node === 'build' || node === 'static_validate') {
        events.push({
          type: 'token',
          runId,
          content:
            state.planFeedback && node === 'static_validate'
              ? 'Static check found issues, refining the plan ⏳\n'
              : 'Building and validating the workflow ✓\n',
        });
      } else if (node === 'provision' && state.automationId) {
        events.push({ type: 'token', runId, content: 'Provisioning in your n8n ✓\n' });
      } else if (node === 'verify' && state.verifyOk) {
        events.push({ type: 'token', runId, content: 'Provisioning verified ✓\n' });
      } else if (node === 'test_execute') {
        events.push({ type: 'token', runId, content: 'Testing the workflow ⏳\n' });
      } else if (node === 'diagnose' && typeof state.diagnosis === 'string') {
        events.push({
          type: 'token',
          runId,
          content: `Diagnosing the issue ⏳\n${state.diagnosis}\n`,
        });
      } else if (node === 'repair') {
        events.push({ type: 'token', runId, content: 'Repairing and re-provisioning ⏳\n' });
      } else if (node === 'complete' && typeof state.response === 'string') {
        events.push({
          type: 'run.completed',
          runId,
          response: state.response,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        });
      } else if (node === 'escalate' && typeof state.response === 'string') {
        events.push({
          type: 'run.failed',
          runId,
          code: 'AUTOMATION_ESCALATED',
          message: state.response,
        });
      } else if (node === 'ask_clarification' && typeof state.response === 'string') {
        events.push({ type: 'token', runId, content: state.response });
        events.push({ type: 'run.waiting', runId, reason: 'clarification' });
      } else if (node === 'defer_build' && typeof state.response === 'string') {
        events.push({ type: 'token', runId, content: state.response });
        events.push({ type: 'run.waiting', runId, reason: 'clarification' });
      }
    }
    return events;
  }

  private result(
    runId: string,
    result: AutomationGraphState,
    status: 'WAITING' | 'COMPLETED' | 'FAILED',
  ): ExecuteResponse {
    return {
      runId,
      mode: 'automation_design',
      // Clarification answers park the row as WAITING (pendingContext carries
      // the question into the next turn) — report that honestly. Escalations
      // park the row as FAILED with the §42 message as the response.
      status: result.waitingReason ? 'WAITING' : result.escalated ? 'FAILED' : status,
      response: result.response ?? '',
      plan: result.blueprint
        ? {
            ...(result.blueprint as unknown as Record<string, unknown>),
            blueprintRevision: blueprintRevision(result.blueprint),
          }
        : undefined,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * Human-readable design summary for the approval gate — the non-stream
   * client has nothing else to render while WAITING. Tolerant of the trimmed
   * interrupt copy (trigger as string, no integrations/riskNotes).
   */
  private formatApprovalSummary(
    blueprint:
      | AutomationBlueprint
      | {
          name?: string;
          goal?: string;
          trigger?: { type?: string } | string;
          summary?: string;
          steps?: Array<{ name?: string; action?: string; integration?: string }>;
          integrations?: string[];
          riskNotes?: string[];
        }
      | undefined,
  ): string {
    if (!blueprint?.name) return '';
    const trigger =
      typeof blueprint.trigger === 'string'
        ? blueprint.trigger
        : (blueprint.trigger?.type ?? 'webhook');
    const steps = blueprint.steps ?? [];
    const integrations = blueprint.integrations ?? [];
    const riskNotes = blueprint.riskNotes ?? [];
    return [
      `Draft automation blueprint: ${blueprint.name}`,
      '',
      `Goal: ${blueprint.goal ?? ''}`,
      `Trigger: ${trigger}`,
      '',
      blueprint.summary ?? '',
      '',
      'Steps:',
      ...steps.map(
        (step, index) =>
          `- ${index + 1}. ${step.name} — ${step.action}${step.integration ? ` (via ${step.integration})` : ''}`,
      ),
      '',
      `Integrations: ${integrations.join(', ') || 'None specified'}`,
      '',
      ...(riskNotes.length ? ['Risk notes:', ...riskNotes.map((item) => `- ${item}`), ''] : []),
      'This design is ready for your review. Nothing has been provisioned yet. Approve it when you want me to create the automation in your n8n instance.',
    ].join('\n');
  }

  /**
   * Humanizes a design-stage failure for the user. The raw graph error
   * (review codes, validation details) is kept short; the contract is
   * explicit: a failed design never provisions anything.
   */
  private designFailureMessage(message: string): string {
    const short = message.length > 300 ? `${message.slice(0, 300)}…` : message;
    if (/cut off|truncat|finish.?reason.{0,20}length/i.test(message)) {
      return `the design was too large for one response and got cut off (${short}). Try a simpler automation or split it into parts, and I'll draft it.`;
    }
    if (/failed review|static validation/i.test(message)) {
      return `the design didn't pass my own validation checks (${short}). Try simplifying the request or giving more concrete details, and I'll draft it again.`;
    }
    if (/plan generation failed|No object generated/i.test(message)) {
      return `I couldn't draft a valid design this time (${short}). Please rephrase the request slightly and I'll try again.`;
    }
    return `${short}. Please adjust the request and I'll try again.`;
  }

  private scopeFailure(runId: string, scope: 'user' | 'organization'): ExecuteResponse {
    return {
      runId,
      mode: 'automation_design',
      status: 'FAILED',
      response: `This automation is not available in the current ${scope} scope.`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  private isInterrupted(
    result: unknown,
  ): result is AutomationGraphState & { __interrupt__: unknown } {
    return Boolean(result && typeof result === 'object' && '__interrupt__' in result);
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
