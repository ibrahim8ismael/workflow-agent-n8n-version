import { Injectable } from '@nestjs/common';
import { type AgentRunTrace, AgentRunTraceService } from '../services/agent-run-trace.service';

export interface RegressionDraft {
  /** Suggested scenario id (`regression-<run8>`). */
  id: string;
  category: 'failure';
  input: string;
  expectedOutcome: string;
  /** Offline case derived from the failure stage — review before appending. */
  offline: {
    kind: 'classify-error';
    message: string;
    stage: string;
    expectedCode: string;
  } | null;
  notes: string;
}

/**
 * Failure → Evaluation pipeline (docs/Jaafar-improve.md §35).
 *
 * Converts a failed production run's trace into a REVIEWABLE regression
 * draft. Drafts are returned, never auto-appended — a developer confirms
 * the expected code before the case joins the dataset (release gate §48).
 */
@Injectable()
export class JaafarFailureEvalService {
  constructor(private readonly traces: AgentRunTraceService) {}

  async draftRegressionFromRun(runId: string): Promise<RegressionDraft> {
    const trace = await this.traces.trace(runId);
    return this.draftRegression(trace);
  }

  draftRegression(trace: AgentRunTrace): RegressionDraft {
    const lastError = this.lastError(trace);
    const stage = this.failureStage(trace);
    return {
      id: `regression-${trace.runId.slice(0, 8)}`,
      category: 'failure',
      input: this.describeRun(trace),
      expectedOutcome: `Regression guard for ${stage} failure: ${lastError ?? 'unknown error'}`,
      offline:
        stage && lastError
          ? {
              kind: 'classify-error',
              message: lastError,
              stage,
              expectedCode: this.suspectedCode(lastError),
            }
          : null,
      notes:
        'Review the suspected code against the classifier, adjust, then append to jaafar-eval-dataset.json.',
    };
  }

  private lastError(trace: AgentRunTrace): string | null {
    const failedTransition = [...trace.transitions]
      .reverse()
      .find((t) => t.toStatus === 'FAILED' || t.toPhase === 'FAILED');
    if (failedTransition?.reason) return failedTransition.reason;
    const repairs = trace.repairs as Array<{ diagnosis?: unknown }> | null;
    const lastRepair = Array.isArray(repairs) ? repairs[repairs.length - 1] : undefined;
    if (lastRepair && typeof lastRepair.diagnosis === 'string') return lastRepair.diagnosis;
    return null;
  }

  private failureStage(trace: AgentRunTrace): string {
    const failedTransition = [...trace.transitions]
      .reverse()
      .find((t) => t.toStatus === 'FAILED' || t.toPhase === 'FAILED');
    const reason = (failedTransition?.reason ?? '').toLowerCase();
    if (/provision/.test(reason)) return 'provision';
    if (/test|validat/.test(reason)) return 'test';
    if (/verif/.test(reason)) return 'verify';
    if (/plan|review/.test(reason)) return 'build';
    const repairs = trace.repairs as Array<{ stage?: unknown }> | null;
    const lastRepair = Array.isArray(repairs) ? repairs[repairs.length - 1] : undefined;
    if (lastRepair && typeof lastRepair.stage === 'string') return lastRepair.stage;
    return 'unknown';
  }

  private suspectedCode(message: string): string {
    const normalized = message.toLowerCase();
    if (/credential|api key|unauthorized|401|403/.test(normalized)) return 'CREDENTIAL_ERROR';
    if (/permission|forbidden/.test(normalized)) return 'PERMISSION_ERROR';
    if (/rate limit|429/.test(normalized)) return 'RATE_LIMIT';
    if (/timeout|timed out/.test(normalized)) return 'TIMEOUT';
    if (/not found|missing/.test(normalized)) return 'MISSING_DATA';
    if (/expression|syntax|unbalanced/.test(normalized)) return 'INVALID_EXPRESSION';
    if (/validation|invalid plan|review/.test(normalized)) return 'INVALID_CONFIGURATION';
    if (/unreachable|econn|50\d/.test(normalized)) return 'API_ERROR';
    return 'UNKNOWN';
  }

  private describeRun(trace: AgentRunTrace): string {
    const goal =
      (trace.plan as Record<string, unknown> | null)?.goal ??
      (trace.understanding.requirements as unknown[] | null)?.length;
    return `Automation run ${trace.runId} (${trace.phase ?? trace.status}) — goal: ${typeof goal === 'string' ? goal : 'see trace'}`;
  }
}
