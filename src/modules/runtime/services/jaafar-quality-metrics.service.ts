import { Injectable } from '@nestjs/common';
import { isTerminalRunStatus } from '../../runs/agent-run-phase';
import { RunsService } from '../../runs/runs.service';

export interface QualityMetricsInput {
  since?: Date;
  organizationId?: string;
  agentId?: string;
  limit?: number;
}

export interface QualityMetrics {
  window: { since: string | null; runs: number };
  statusCounts: Record<string, number>;
  phaseCounts: Record<string, number>;
  /** COMPLETED / terminal runs. */
  successRate: number | null;
  failureRate: number | null;
  /** Currently WAITING / all runs in window. */
  waitingRate: number | null;
  /** Runs that asked a clarification question / all runs (proxy for unnecessary questions). */
  clarificationRate: number | null;
  /** validationResult.valid / runs with a validation result. */
  validationPassRate: number | null;
  repair: {
    attempted: number;
    repaired: number;
    repairSuccessRate: number | null;
    avgAttempts: number | null;
  };
  averages: {
    durationMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    estimatedCost: number | null;
  };
  totals: { estimatedCost: number };
}

const MAX_WINDOW = 1000;

/**
 * Agent Quality Dashboard source (docs/Jaafar-improve.md §33, §46).
 *
 * Computes success/validity/repair/clarification/cost metrics from stored
 * run rows over a bounded window. Pure aggregation — no LLM, no n8n.
 */
@Injectable()
export class JaafarQualityMetricsService {
  constructor(private readonly runs: RunsService) {}

  async metrics(input: QualityMetricsInput = {}): Promise<QualityMetrics> {
    const rows = (await this.runs.list({
      where: {
        ...(input.since ? { createdAt: { gte: input.since } } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(input.limit ?? MAX_WINDOW, MAX_WINDOW),
    })) as Array<Record<string, unknown>>;

    const statusCounts: Record<string, number> = {};
    const phaseCounts: Record<string, number> = {};
    let terminal = 0;
    let completed = 0;
    let failed = 0;
    let waiting = 0;
    let clarified = 0;
    let validated = 0;
    let validationPassed = 0;
    let attempted = 0;
    let repaired = 0;
    let repairAttemptsTotal = 0;
    let durationTotal = 0;
    let durationCount = 0;
    let promptTotal = 0;
    let completionTotal = 0;
    let totalTotal = 0;
    let costTotal = 0;

    for (const row of rows) {
      const status = String(row.status ?? 'UNKNOWN');
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const phase = String(row.currentPhase ?? 'UNKNOWN');
      phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;

      if (isTerminalRunStatus(status)) {
        terminal += 1;
        if (status === 'COMPLETED') completed += 1;
        if (status === 'FAILED') failed += 1;
      }
      if (status === 'WAITING') waiting += 1;

      const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
      if (typeof metadata.clarificationQuestion === 'string' && metadata.clarificationQuestion) {
        clarified += 1;
      }
      const validation = row.validationResult as { valid?: unknown } | null;
      if (validation && typeof validation === 'object' && 'valid' in validation) {
        validated += 1;
        if (validation.valid === true) validationPassed += 1;
      }
      const attempts = Array.isArray(row.repairAttempts) ? row.repairAttempts.length : 0;
      if (attempts > 0) {
        attempted += 1;
        repairAttemptsTotal += attempts;
        if (status === 'COMPLETED') repaired += 1;
      }
      if (typeof row.durationMs === 'number') {
        durationTotal += row.durationMs;
        durationCount += 1;
      }
      promptTotal += Number(row.promptTokens ?? 0);
      completionTotal += Number(row.completionTokens ?? 0);
      totalTotal += Number(row.totalTokens ?? 0);
      costTotal += Number(row.estimatedCost ?? 0);
    }

    const count = rows.length;
    const avg = (total: number, n: number): number | null => (n > 0 ? total / n : null);
    return {
      window: { since: input.since ? input.since.toISOString() : null, runs: count },
      statusCounts,
      phaseCounts,
      successRate: terminal > 0 ? completed / terminal : null,
      failureRate: terminal > 0 ? failed / terminal : null,
      waitingRate: count > 0 ? waiting / count : null,
      clarificationRate: count > 0 ? clarified / count : null,
      validationPassRate: validated > 0 ? validationPassed / validated : null,
      repair: {
        attempted,
        repaired,
        repairSuccessRate: attempted > 0 ? repaired / attempted : null,
        avgAttempts: attempted > 0 ? repairAttemptsTotal / attempted : null,
      },
      averages: {
        durationMs: avg(durationTotal, durationCount),
        promptTokens: avg(promptTotal, count),
        completionTokens: avg(completionTotal, count),
        totalTokens: avg(totalTotal, count),
        estimatedCost: avg(costTotal, count),
      },
      totals: { estimatedCost: costTotal },
    };
  }
}
