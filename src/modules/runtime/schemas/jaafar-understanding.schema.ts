import { z } from 'zod';

/**
 * LLMs frequently emit explicit nulls for unknown optionals
 * (`"schedule": null`). Zod `.default()` only covers `undefined`, so a
 * single null would fail the whole understanding parse (SCHEMA_INVALID →
 * the automation path 500s). Normalize nulls to undefined first so every
 * declared default applies; genuinely missing required strings still fail.
 */
function nullsToUndefined(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(nullsToUndefined);
  if (typeof value === 'object' && value !== undefined) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        nullsToUndefined(entry),
      ]),
    );
  }
  return value;
}

const requirementSchema = z.object({
  /** Stable id assigned by the understanding service (R1, R2, …). */
  id: z.string().max(20).optional(),
  field: z.string().min(1).max(100),
  value: z.string().max(500),
  required: z.boolean(),
  source: z.enum(['user', 'history', 'inferred', 'retrieved']),
});

const assumptionSchema = z.object({
  statement: z.string().min(1).max(300),
  rationale: z.string().max(300).default(''),
  /** Safe to proceed without asking when true. */
  reversible: z.boolean().default(true),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
});

export const jaafarUnderstandingSchema = z.preprocess(
  nullsToUndefined,
  z.object({
    intent: z.enum(['conversation', 'automation_design', 'task_execution', 'general_question']),
    goal: z.string().min(1).max(500),
    businessContext: z.string().max(1000).default(''),
    /** What starts the automation (V2 §10). `none` for non-automation intents. */
    trigger: z
      .object({
        kind: z.enum(['webhook', 'schedule', 'manual', 'chat', 'none']).default('none'),
        event: z.string().max(200).default(''),
        schedule: z.string().max(200).default(''),
      })
      .default({ kind: 'none', event: '', schedule: '' }),
    /** Concrete actions the user wants done, in their words. */
    actions: z.array(z.string().min(1).max(200)).max(10).default([]),
    /** Systems, tools, people, data named in the request. */
    entities: z.array(z.string().min(1).max(100)).max(15).default([]),
    /** Conditions/branches the automation must respect. */
    conditions: z.array(z.string().min(1).max(200)).max(10).default([]),
    /** Hard constraints (never do X, only during Y…). */
    constraints: z.array(z.string().min(1).max(200)).max(10).default([]),
    /** Observable outcome that would satisfy the request. */
    desiredOutcome: z.string().max(500).default(''),
    requirements: z.array(requirementSchema).max(20).default([]),
    /** Explicit assumptions Jaafar may act on (V2 §12 Assumption Engine). */
    assumptions: z.array(assumptionSchema).max(10).default([]),
    missingInputs: z
      .array(
        z.object({
          field: z.string().min(1).max(100),
          description: z.string().min(1).max(500),
          question: z.string().min(1).max(500),
          required: z.boolean(),
        }),
      )
      .max(10)
      .default([]),
    // Default 0.5, not 1: a model omitting confidence must NOT pass as fully
    // confident (that skipped the < 0.6 self-correction pass).
    confidence: z.number().min(0).max(1).default(0.5),
    clarificationRequired: z.boolean().default(false),
    clarificationQuestion: z.string().max(500).optional(),
    /**
     * Explicit user request for a generic implementation node instead of the
     * native integration node. Set ONLY on explicit wording ("use HTTP
     * Request", "call the API directly", "use the Code node"). Integration
     * terminology alone ("send through the WhatsApp API") is NOT an
     * override — the word "API" is insufficient evidence.
     */
    genericNodeOverride: z
      .object({
        requested: z.boolean().default(false),
        type: z.enum(['httpRequest', 'code']).optional(),
      })
      .default({ requested: false }),
  }),
);

export type JaafarUnderstandingOutput = z.infer<typeof jaafarUnderstandingSchema>;
