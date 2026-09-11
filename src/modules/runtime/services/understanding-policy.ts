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
  const used = new Set<string>();
  return requirements.map((requirement) => {
    if (requirement.id && !used.has(requirement.id)) {
      used.add(requirement.id);
      return requirement;
    }
    // Missing OR duplicate model-supplied id — re-assign so the plan
    // coverage map can never see two requirements claiming one R-id.
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
  // Priority: explicit question → REQUIRED missing input → safety
  // confirmation → any missing input. An optional nice-to-have must never
  // preempt a confirmation the run cannot safely proceed without.
  const requiredMissing = input.missingInputs.find((missing) => missing.required);
  const question =
    input.clarificationQuestion ??
    (requiredMissing
      ? requiredMissing.question
      : input.confirmationsNeeded.length > 0
        ? `Before I proceed, please confirm: ${input.confirmationsNeeded.map((a) => a.statement).join('; ')}`
        : input.missingInputs[0]?.question);
  return { required, question: question ?? GENERIC_CLARIFICATION_QUESTION };
}
