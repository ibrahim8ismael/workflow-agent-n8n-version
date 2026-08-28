import { createHash } from 'node:crypto';
import { z } from 'zod';

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
        name: z.string().min(1).max(120),
        action: z.string().min(1).max(200),
        description: z.string().max(600).optional(),
        integration: z.string().max(80).optional(),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(20),
  integrations: z.array(z.string().max(80)).max(20),
  inputContract: z.record(z.string(), z.unknown()).default({}),
  outputContract: z.record(z.string(), z.unknown()).default({}),
  riskNotes: z.array(z.string().max(300)).max(10).default([]),
});

export type AutomationBlueprint = z.infer<typeof automationBlueprintSchema>;

/** Stable content hash used as the blueprint revision marker. */
export function blueprintRevision(blueprint: AutomationBlueprint): string {
  const { ready: _ready, missingRequirements: _missing, ...core } = blueprint;
  const canonical = JSON.stringify(core, Object.keys(core).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function automationWebhookSlug(automationId: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'automation'}-${automationId.slice(0, 8)}`;
}
