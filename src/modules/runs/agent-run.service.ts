import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Run } from '@prisma/client';
import {
  AGENT_RUN_PHASE,
  type AgentRunPhase,
  isTerminalRunStatus,
  validateAgentRunStatusMove,
  validatePhaseTransition,
} from './agent-run-phase';
import type { AdvanceAgentRunDto, CreateAgentRunDto } from './dto/agent-run.dto';
import { RunsRepository } from './runs.repository';
export interface AgentRunSnapshot {
  run: Run;
  transitions: Array<{
    id: string;
    runId: string;
    fromStatus: string | null;
    toStatus: string | null;
    fromPhase: string | null;
    toPhase: string | null;
    reason: string | null;
    createdAt: Date;
  }>;
}

const REPAIRABLE_PHASES: AgentRunPhase[] = [
  AGENT_RUN_PHASE.FAILED,
  AGENT_RUN_PHASE.DIAGNOSING,
  AGENT_RUN_PHASE.REPAIRING,
];

/**
 * Jaafar V2 run lifecycle (docs/Jaafar-improve.md §1–§2, @TODOS.JAAFAR.V2.md Phase 1).
 *
 * Owns the AgentRun state machine: every state change is validated against
 * the phase/transition maps, persisted with a reason, journaled into
 * agent_run_transitions, and guarded by optimistic concurrency (Run.version).
 * Legacy flows keep using RunsService; the V2 graph (Phase 3) drives runs
 * exclusively through this service.
 */
@Injectable()
export class AgentRunService {
  constructor(private readonly runsRepository: RunsRepository) {}

  async createAgentRun(dto: CreateAgentRunDto): Promise<Run> {
    return this.runsRepository.createAgentRun(
      {
        agent: { connect: { id: dto.agentId } },
        ...(dto.conversationId ? { conversation: { connect: { id: dto.conversationId } } } : {}),
        userId: dto.userId,
        organizationId: dto.organizationId,
        // Release line stamp (§47-lite): distinguishes V2 lifecycle rows from
        // legacy runs in traces and metrics.
        metadata: {
          ...((dto.metadata as Record<string, unknown> | undefined) ?? {}),
          agentRunVersion: 'v2',
        } as never,
        status: 'CREATED',
        currentPhase: AGENT_RUN_PHASE.UNDERSTANDING,
        ...(dto.businessContext !== undefined
          ? { businessContext: dto.businessContext as never }
          : {}),
        ...(dto.requirements !== undefined ? { requirements: dto.requirements as never } : {}),
        ...(dto.assumptions !== undefined ? { assumptions: dto.assumptions as never } : {}),
        ...(dto.constraints !== undefined ? { constraints: dto.constraints as never } : {}),
        repairAttempts: [],
      } as never,
      'agent run created',
    );
  }

  /**
   * Move a run forward in phase and/or status. Phase moves are validated
   * against the V2 phase map; status moves against the status map
   * (terminal sources can never move; any non-terminal source may close).
   */
  async advance(runId: string, input: AdvanceAgentRunDto): Promise<Run> {
    const run = await this.findOrThrow(runId);
    const fromPhase = run.currentPhase as AgentRunPhase;
    const toPhase = (input.toPhase ?? fromPhase) as AgentRunPhase;
    const fromStatus = run.status;
    const toStatus = input.toStatus ?? fromStatus;

    if (toPhase !== fromPhase) validatePhaseTransition(fromPhase, toPhase);
    if (toStatus !== fromStatus) {
      // Terminal rows never move again — except the V2 repair-resume edge:
      // a FAILED run whose phase still allows repair may return to
      // EXECUTING (phase hop validated above; Phase 4 drives DIAGNOSING →
      // REPAIRING → EXECUTING through here).
      const repairResume =
        fromStatus === 'FAILED' &&
        toStatus === 'EXECUTING' &&
        toPhase !== AGENT_RUN_PHASE.COMPLETED;
      validateAgentRunStatusMove(fromStatus, toStatus, toPhase, { repairResume });
    }
    if (toPhase === fromPhase && toStatus === fromStatus) return run;

    const reason = input.reason ?? this.defaultReason(fromPhase, toPhase, fromStatus, toStatus);
    const data = {
      ...(toPhase !== fromPhase ? { currentPhase: toPhase } : {}),
      ...(toStatus !== fromStatus
        ? {
            status: toStatus as never,
            ...(isTerminalRunStatus(toStatus) ? { completedAt: new Date() } : {}),
          }
        : {}),
    } as never;

    const updated = await this.runsRepository.transitionRun(
      runId,
      input.expectedVersion ?? run.version,
      data,
      { fromStatus, toStatus, fromPhase, toPhase, reason },
    );
    if (!updated) {
      throw new ConflictException(
        `Agent run ${runId} changed concurrently; reload and retry the transition`,
      );
    }
    return updated;
  }

  /** Everything a graph needs to resume: the row + its full transition trail. */
  async snapshot(runId: string): Promise<AgentRunSnapshot> {
    const run = await this.findOrThrow(runId);
    const transitions = await this.runsRepository.listTransitions(runId);
    return { run, transitions };
  }

  /**
   * Persists stage artifacts (plan, validation, execution results, workflow
   * pointers) without moving phase/status. Journaled so the trail shows
   * what was recorded and when.
   */
  async recordArtifacts(
    runId: string,
    artifacts: {
      businessContext?: unknown;
      requirements?: unknown;
      assumptions?: unknown;
      constraints?: unknown;
      automationPlan?: unknown;
      workflowId?: string | null;
      workflowVersion?: number | null;
      validationResult?: unknown;
      executionResults?: unknown;
      metrics?: unknown;
    },
    reason = 'stage artifacts recorded',
  ): Promise<Run> {
    const run = await this.findOrThrow(runId);
    const data = {
      ...(artifacts.businessContext !== undefined
        ? { businessContext: artifacts.businessContext as never }
        : {}),
      ...(artifacts.requirements !== undefined
        ? { requirements: artifacts.requirements as never }
        : {}),
      ...(artifacts.assumptions !== undefined
        ? { assumptions: artifacts.assumptions as never }
        : {}),
      ...(artifacts.constraints !== undefined
        ? { constraints: artifacts.constraints as never }
        : {}),
      ...(artifacts.automationPlan !== undefined
        ? { automationPlan: artifacts.automationPlan as never }
        : {}),
      ...(artifacts.workflowId !== undefined ? { workflowId: artifacts.workflowId } : {}),
      ...(artifacts.workflowVersion !== undefined
        ? { workflowVersion: artifacts.workflowVersion }
        : {}),
      ...(artifacts.validationResult !== undefined
        ? { validationResult: artifacts.validationResult as never }
        : {}),
      ...(artifacts.executionResults !== undefined
        ? { executionResults: artifacts.executionResults as never }
        : {}),
      ...(artifacts.metrics !== undefined ? { metrics: artifacts.metrics as never } : {}),
    } as never;
    const updated = await this.runsRepository.transitionRun(runId, run.version, data, {
      fromStatus: run.status,
      toStatus: run.status,
      fromPhase: run.currentPhase,
      toPhase: run.currentPhase,
      reason,
    });
    if (!updated) {
      throw new ConflictException(
        `Agent run ${runId} changed concurrently; reload and retry the transition`,
      );
    }
    return updated;
  }

  /**
   * Resume an interrupted run from its last valid state. WAITING runs return
   * to EXECUTING; terminal runs cannot resume; anything else (already
   * running) returns the snapshot unchanged.
   */
  async resume(runId: string, reason = 'run resumed'): Promise<Run> {
    const run = await this.findOrThrow(runId);
    if (isTerminalRunStatus(run.status)) {
      throw new ConflictException(`Cannot resume a ${run.status} agent run`);
    }
    if (run.status !== 'WAITING') return run;
    return this.advance(runId, { toStatus: 'EXECUTING', reason });
  }

  /** True when a failed run still holds a repairable phase (Phase 4 consumes this). */ async isRepairable(
    runId: string,
  ): Promise<boolean> {
    const run = await this.findOrThrow(runId);
    return run.status === 'FAILED' && REPAIRABLE_PHASES.includes(run.currentPhase as AgentRunPhase);
  }

  /**
   * Appends one repair attempt to the run's repairAttempts trail (§24).
   * Version-guarded like every other lifecycle write.
   */
  async appendRepairAttempt(
    runId: string,
    attempt: {
      attempt: number;
      at: string;
      stage: string;
      code: string;
      diagnosis: string;
      changes: string[];
      blueprintRevision: string;
    },
  ): Promise<Run> {
    const run = await this.findOrThrow(runId);
    const trail = Array.isArray(run.repairAttempts) ? [...(run.repairAttempts as unknown[])] : [];
    trail.push(attempt);
    const updated = await this.runsRepository.transitionRun(
      runId,
      run.version,
      { repairAttempts: trail as never },
      {
        fromStatus: run.status,
        toStatus: run.status,
        fromPhase: run.currentPhase,
        toPhase: run.currentPhase,
        reason: `repair attempt ${attempt.attempt} (${attempt.code})`,
      },
    );
    if (!updated) {
      throw new ConflictException(
        `Agent run ${runId} changed concurrently; reload and retry the transition`,
      );
    }
    return updated;
  }

  async cancel(runId: string, reason = 'agent run cancelled'): Promise<Run> {
    return this.advance(runId, { toStatus: 'CANCELLED', reason });
  }

  private async findOrThrow(runId: string): Promise<Run> {
    const run = await this.runsRepository.findById(runId);
    if (!run) throw new NotFoundException(`Agent run with id "${runId}" not found`);
    return run;
  }

  private defaultReason(
    fromPhase: string,
    toPhase: string,
    fromStatus: string,
    toStatus: string,
  ): string {
    if (toPhase !== fromPhase && toStatus !== fromStatus) {
      return `phase ${fromPhase} → ${toPhase}; status ${fromStatus} → ${toStatus}`;
    }
    if (toPhase !== fromPhase) return `phase ${fromPhase} → ${toPhase}`;
    return `status ${fromStatus} → ${toStatus}`;
  }
}
