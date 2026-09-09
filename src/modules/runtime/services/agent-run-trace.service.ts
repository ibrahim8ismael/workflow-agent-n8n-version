import { Injectable } from '@nestjs/common';
import { AgentRunService } from '../../runs/agent-run.service';

/** Jaafar release line stamped on every V2 run (observability §29, §47-lite). */
export const JAAFAR_RUN_VERSION = 'v2';

export interface AgentRunTraceTransition {
  at: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromPhase: string | null;
  toPhase: string | null;
  reason: string | null;
}

export interface AgentRunTrace {
  runId: string;
  agentId: string;
  conversationId: string | null;
  userId: string | null;
  organizationId: string | null;
  agentRunVersion: string | null;
  status: string;
  phase: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
    durationMs: number | null;
  };
  understanding: {
    goal: unknown;
    requirements: unknown;
    assumptions: unknown;
    constraints: unknown;
    businessContext: unknown;
  };
  plan: unknown;
  validation: unknown;
  execution: unknown;
  repairs: unknown[];
  coverage: unknown;
  /** The n8n side of the correlation (run ↔ workflow). */
  automation: {
    automationId: unknown;
    externalWorkflowId: unknown;
    webhookPath: unknown;
    automationVersion: unknown;
  };
  transitions: AgentRunTraceTransition[];
  /** Last journaled SSE events (bounded at write time). */
  events: Array<{ type: string; occurredAt: string; payload: unknown }>;
}

/**
 * Run Trace assembly (docs/Jaafar-improve.md §29).
 *
 * One JSON document per run: LLM usage, state transitions, journaled events,
 * plan/coverage, validation + execution results, repair trail, and the n8n
 * correlation ids. Assembled from existing stores — no new tables, no new
 * queries beyond the snapshot the lifecycle already provides.
 */
@Injectable()
export class AgentRunTraceService {
  constructor(private readonly agentRuns: AgentRunService) {}

  async trace(runId: string): Promise<AgentRunTrace> {
    const { run, transitions } = await this.agentRuns.snapshot(runId);
    const row = run as Record<string, unknown>;
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    const execution = (row.executionResults as Record<string, unknown> | null) ?? {};
    const events = Array.isArray(metadata.runtimeEvents)
      ? (metadata.runtimeEvents as Array<{ type: string; occurredAt: string; payload: unknown }>)
      : [];
    return {
      runId: row.id as string,
      agentId: row.agentId as string,
      conversationId: (row.conversationId as string | null) ?? null,
      userId: (row.userId as string | null) ?? null,
      organizationId: (row.organizationId as string | null) ?? null,
      agentRunVersion: (metadata.agentRunVersion as string | null) ?? null,
      status: row.status as string,
      phase: (row.currentPhase as string | null) ?? null,
      createdAt: (row.createdAt as Date)?.toISOString?.() ?? String(row.createdAt),
      updatedAt: (row.updatedAt as Date)?.toISOString?.() ?? String(row.updatedAt),
      completedAt: row.completedAt
        ? ((row.completedAt as Date)?.toISOString?.() ?? String(row.completedAt))
        : null,
      usage: {
        promptTokens: Number(row.promptTokens ?? 0),
        completionTokens: Number(row.completionTokens ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        estimatedCost: Number(row.estimatedCost ?? 0),
        durationMs: (row.durationMs as number | null) ?? null,
      },
      understanding: {
        goal: (row.automationPlan as Record<string, unknown> | null)?.goal ?? null,
        requirements: row.requirements ?? null,
        assumptions: row.assumptions ?? null,
        constraints: row.constraints ?? null,
        businessContext: row.businessContext ?? null,
      },
      plan: row.automationPlan ?? null,
      validation: row.validationResult ?? null,
      execution: row.executionResults ?? null,
      repairs: Array.isArray(row.repairAttempts) ? (row.repairAttempts as unknown[]) : [],
      coverage:
        (row.validationResult as Record<string, unknown> | null)?.coverage ??
        (metadata.coverage as unknown) ??
        null,
      automation: {
        automationId: execution.automationId ?? null,
        externalWorkflowId: execution.externalWorkflowId ?? row.workflowId ?? null,
        webhookPath: execution.webhookPath ?? null,
        automationVersion: execution.automationVersion ?? row.workflowVersion ?? null,
      },
      transitions: transitions.map((transition) => ({
        at: transition.createdAt.toISOString(),
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        fromPhase: transition.fromPhase,
        toPhase: transition.toPhase,
        reason: transition.reason,
      })),
      events,
    };
  }
}
