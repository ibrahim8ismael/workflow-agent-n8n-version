/**
 * Jaafar V2 agent lifecycle (docs/Jaafar-improve.md §0–§2).
 *
 * A phase describes WHERE a run is in the automation pipeline
 * (understand → plan → build → validate → execute → verify → repair);
 * RunStatus describes the technical row state (WAITING, COMPLETED…).
 *
 * The FAILED phase is NOT terminal: a failed run may enter DIAGNOSING →
 * REPAIRING and return to EXECUTING. Terminal row states are enforced
 * separately — status COMPLETED/FAILED/CANCELLED/TIMEOUT can never be
 * left (a completed run cannot accidentally keep mutating).
 */

export const AGENT_RUN_PHASE = {
  UNDERSTANDING: 'UNDERSTANDING',
  PLANNING: 'PLANNING',
  BUILDING: 'BUILDING',
  STATIC_VALIDATION: 'STATIC_VALIDATION',
  EXECUTING: 'EXECUTING',
  RUNTIME_VALIDATION: 'RUNTIME_VALIDATION',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DIAGNOSING: 'DIAGNOSING',
  REPAIRING: 'REPAIRING',
} as const;

export type AgentRunPhase = (typeof AGENT_RUN_PHASE)[keyof typeof AGENT_RUN_PHASE];

/** Allowed phase hops. A missing entry means the phase is terminal. */
export const AGENT_RUN_PHASE_TRANSITIONS: Record<AgentRunPhase, AgentRunPhase[]> = {
  UNDERSTANDING: ['PLANNING', 'FAILED'],
  PLANNING: ['BUILDING', 'FAILED'],
  BUILDING: ['STATIC_VALIDATION', 'FAILED'],
  STATIC_VALIDATION: ['EXECUTING', 'BUILDING', 'FAILED'],
  EXECUTING: ['RUNTIME_VALIDATION', 'FAILED'],
  RUNTIME_VALIDATION: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['DIAGNOSING'],
  DIAGNOSING: ['REPAIRING', 'FAILED'],
  REPAIRING: ['EXECUTING', 'FAILED'],
};

/** Row states that close a run. Nothing may transition out of these. */
export const TERMINAL_RUN_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'] as const;

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export function isAgentRunPhase(value: unknown): value is AgentRunPhase {
  return typeof value === 'string' && (Object.values(AGENT_RUN_PHASE) as string[]).includes(value);
}

export function validatePhaseTransition(from: AgentRunPhase, to: AgentRunPhase): void {
  const allowed = AGENT_RUN_PHASE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid agent phase transition: ${from} → ${to}`);
  }
}

/**
 * Guard for terminal writes (complete/fail/cancel): a run in a terminal
 * state can never move again. Non-terminal sources may always close.
 */
export function validateTerminalWrite(currentStatus: string, nextStatus: string): void {
  if (isTerminalRunStatus(currentStatus)) {
    throw new Error(
      `Invalid state transition: ${currentStatus} is terminal and cannot move to ${nextStatus}`,
    );
  }
  if (!isTerminalRunStatus(nextStatus)) {
    throw new Error(
      `Invalid state transition: ${currentStatus} → ${nextStatus} is not a terminal write`,
    );
  }
}

/**
 * Legacy hop-by-hop status map (pre-V2 flows still step through these).
 * FAILED → EXECUTING is the V2 repair-resume edge: a failed run that entered
 * DIAGNOSING/REPAIRING may return to EXECUTING via AgentRunService.
 */
export const RUN_STATUS_TRANSITIONS: Record<string, string[]> = {
  CREATED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['PLANNING', 'FAILED', 'CANCELLED'],
  PLANNING: ['EXECUTING', 'WAITING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['WAITING', 'GENERATING', 'FAILED', 'CANCELLED'],
  WAITING: ['EXECUTING', 'TIMEOUT', 'FAILED', 'CANCELLED'],
  GENERATING: ['PERSISTING', 'FAILED', 'CANCELLED'],
  PERSISTING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  FAILED: ['EXECUTING'],
};

export function validateStatusTransition(current: string, next: string): void {
  const allowed = RUN_STATUS_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    throw new Error(`Invalid state transition: ${current} → ${next}`);
  }
}

/**
 * V2 status rule for AgentRunService.advance: the phase machine is the
 * strict gate, so statuses move freely FORWARD (never backward), terminal
 * rows stay locked (repair-resume excepted), and terminal statuses require
 * their matching phase — a run can only be COMPLETED from the COMPLETED
 * phase, which is what kills false "success" reports.
 */
export const RUN_STATUS_RANK: Record<string, number> = {
  CREATED: 0,
  PREPARING: 1,
  PLANNING: 2,
  EXECUTING: 3,
  WAITING: 3,
  GENERATING: 4,
  PERSISTING: 5,
  COMPLETED: 6,
  FAILED: 6,
  CANCELLED: 6,
  TIMEOUT: 6,
};

export function validateAgentRunStatusMove(
  fromStatus: string,
  toStatus: string,
  toPhase: string,
  options: { repairResume?: boolean } = {},
): void {
  if (isTerminalRunStatus(fromStatus) && !options.repairResume) {
    throw new Error(
      `Invalid state transition: ${fromStatus} is terminal and cannot move to ${toStatus}`,
    );
  }
  if (toStatus === 'COMPLETED' && toPhase !== 'COMPLETED') {
    throw new Error(
      `Cannot mark an agent run COMPLETED while in phase ${toPhase} — completion requires the COMPLETED phase`,
    );
  }
  if (toStatus === 'FAILED' && toPhase !== 'FAILED') {
    throw new Error(
      `Cannot mark an agent run FAILED while in phase ${toPhase} — failure must land in the FAILED phase`,
    );
  }
  if (
    !options.repairResume &&
    !isTerminalRunStatus(toStatus) &&
    (RUN_STATUS_RANK[toStatus] ?? 0) < (RUN_STATUS_RANK[fromStatus] ?? 0)
  ) {
    throw new Error(`Invalid state transition: ${fromStatus} → ${toStatus} moves backward`);
  }
}
