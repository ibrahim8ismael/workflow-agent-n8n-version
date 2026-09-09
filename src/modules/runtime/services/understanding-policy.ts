import type {
  JaafarAssumption,
  JaafarMissingInput,
  JaafarRequirement,
} from '../types/jaafar-understanding.types';

export const GENERIC_CLARIFICATION_QUESTION =
  'What outcome would you like Jaafar to help you achieve?';

/**
 * Stable requirement ids (R1, R2, …) — the plan coverage map (§20)
 * references these, so they must survive across stages. Pure.
 */
export function assignRequirementIds<T extends JaafarRequirement>(requirements: T[]): T[] {
  let counter = 0;
  const used = new Set(requirements.map((r) => r.id).filter((id): id is string => Boolean(id)));
  return requirements.map((requirement) => {
    if (requirement.id) return requirement;
    do {
      counter += 1;
    } while (used.has(`R${counter}`));
    const id = `R${counter}`;
    used.add(id);
    return { ...requirement, id };
  });
}

/**
 * Assumption Engine policy (§12) — pure. Reversible low/medium-risk
 * assumptions proceed silently; high-risk or irreversible ones need
 * explicit user confirmation.
 */
export function applyAssumptionPolicy<T extends JaafarAssumption>(
  assumptions: T[],
): {
  assumptions: Array<T & { needsConfirmation: boolean }>;
  confirmationsNeeded: Array<T & { needsConfirmation: boolean }>;
} {
  const resolved = assumptions.map((assumption) => ({
    ...assumption,
    needsConfirmation: assumption.risk === 'high' || !assumption.reversible,
  }));
  return {
    assumptions: resolved,
    confirmationsNeeded: resolved.filter((a) => a.needsConfirmation),
  };
}

export interface ClarificationInput {
  clarificationRequired: boolean;
  missingInputs: JaafarMissingInput[];
  confirmationsNeeded: Array<{ statement: string }>;
  clarificationQuestion?: string;
}

/** Decides whether to ask, and the single focused question. Pure. */
export function resolveClarification(input: ClarificationInput): {
  required: boolean;
  question: string | undefined;
} {
  const missingRequired = input.missingInputs.some((missing) => missing.required);
  const required =
    input.clarificationRequired || missingRequired || input.confirmationsNeeded.length > 0;
  if (!required) return { required, question: undefined };
  const question =
    input.clarificationQuestion ??
    input.missingInputs[0]?.question ??
    (input.confirmationsNeeded.length > 0
      ? `Before I proceed, please confirm: ${input.confirmationsNeeded.map((a) => a.statement).join('; ')}`
      : undefined);
  return { required, question: question ?? GENERIC_CLARIFICATION_QUESTION };
}
