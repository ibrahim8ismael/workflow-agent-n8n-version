import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * n8n node type reference (e.g. `n8n-nodes-base.whatsApp`,
 * `n8n-nodes-base.dataTable`, `@n8n/n8n-nodes-langchain.agent`).
 * Free-form by design: Jaafar picks types from the client's harvested
 * instance inventory — no platform-side allowlist.
 */
const n8nNodeTypeSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9@][a-zA-Z0-9@._/-]*\.[a-zA-Z0-9.@_-]+$/, {
    message: 'node type must look like package.TypeName (e.g. n8n-nodes-base.whatsApp)',
  });

export const nodeHintSchema = z.object({
  type: n8nNodeTypeSchema,
  typeVersion: z.number().positive().max(1000).optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  /**
   * Why Jaafar chose this node: native availability, HTTP fallback reason,
   * or explicit user override. Required on generic picks so the choice is
   * auditable in review, approval, and evals.
   */
  nodeChoiceReason: z.string().max(500).optional(),
  /**
   * STATIC required credential TYPE (e.g. `gmailOAuth2`). Describes the
   * requirement only — never a credential id/secret, and never mutable
   * readiness state (`NEEDS_CREDENTIAL` lives on Automation, not here).
   */
  credentialType: z.string().min(1).max(80).optional(),
});

export const dataTableColumnSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['string', 'number', 'boolean', 'date']).default('string'),
});

/**
 * AutomationBlueprint — the artifact Jaafar designs and the user approves.
 * Immutability rule: after approval the persisted blueprint never mutates;
 * revisions create a new version (see blueprintRevision).
 */
export const automationBlueprintSchema = z.object({
  ready: z.boolean(),
  missingRequirements: z.array(z.string().max(300)).max(15),
  name: z.string().min(1).max(120),
  goal: z.string().min(1).max(600),
  summary: z.string().max(1200),
  description: z.string().max(1200).default(''),
  trigger: z.object({
    type: z.enum(['webhook', 'schedule', 'manual', 'chat']),
    config: z.record(z.string(), z.unknown()).default({}),
  }),
  steps: z
    .array(
      z.object({
        /** Stable id (S1, S2, …) — assigned by the plan review when missing. */
        id: z.string().max(20).optional(),
        name: z.string().min(1).max(120),
        action: z.string().min(1).max(200),
        description: z.string().max(600).optional(),
        integration: z.string().max(80).optional(),
        /** Requirement ids (R1, R2, …) this step satisfies — coverage map (§20). */
        requirementIds: z.array(z.string().max(20)).max(20).optional(),
        /** Gate for conditional steps (branches, thresholds, filters). */
        condition: z.string().max(300).optional(),
        /** Observable output this step must produce. */
        expectedOutput: z.string().max(300).optional(),
        config: z.record(z.string(), z.unknown()).default({}),
        /** n8n node Jaafar chose from the client's instance inventory. */
        nodeHint: nodeHintSchema.optional(),
      }),
    )
    .min(1)
    .max(20),
  /** New data tables the design needs — provisioned before the workflow. */
  dataTables: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        columns: z.array(dataTableColumnSchema).min(1).max(30),
      }),
    )
    .max(5)
    .optional(),
  integrations: z.array(z.string().max(80)).max(20),
  inputContract: z.record(z.string(), z.unknown()).default({}),
  outputContract: z.record(z.string(), z.unknown()).default({}),
  riskNotes: z.array(z.string().max(300)).max(10).default([]),
});

export type AutomationBlueprint = z.infer<typeof automationBlueprintSchema>;

/** Stable content hash used as the blueprint revision marker. */
export function blueprintRevision(blueprint: AutomationBlueprint): string {
  const { ready: _ready, missingRequirements: _missing, ...core } = blueprint;
  return createHash('sha256').update(stableStringify(core)).digest('hex').slice(0, 16);
}

/**
 * Deep deterministic serialization for the revision hash: recursively sorts
 * object keys at every level, preserves array order. The previous
 * `JSON.stringify(core, Object.keys(core).sort())` array-replacer form only
 * kept top-level keys at all levels, silently dropping nested node choices
 * (nodeHint.type / parameters / nodeChoiceReason) from the revision.
 * Node-selection information is part of the revision; readiness metadata is
 * excluded by the caller above.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function automationWebhookSlug(automationId: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'automation'}-${automationId.slice(0, 8)}`;
}
