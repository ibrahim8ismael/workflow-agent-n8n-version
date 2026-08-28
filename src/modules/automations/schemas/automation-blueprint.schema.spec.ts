import { describe, expect, it } from 'vitest';
import {
  automationBlueprintSchema,
  automationWebhookSlug,
  blueprintRevision,
} from './automation-blueprint.schema';

const validBlueprint = {
  ready: true,
  missingRequirements: [],
  name: 'Invoice sync',
  goal: 'Sync paid invoices to the ledger',
  summary: 'Fetches paid invoices daily and records them.',
  description: 'Daily invoice ledger sync',
  trigger: { type: 'schedule', config: { cron: '0 9 * * *' } },
  steps: [
    {
      name: 'Fetch invoices',
      action: 'Fetch paid invoices from Stripe',
      integration: 'stripe',
      config: {},
    },
  ],
  integrations: ['stripe'],
  inputContract: {},
  outputContract: { result: 'object' },
  riskNotes: ['Creates ledger records'],
};

describe('automationBlueprintSchema', () => {
  it('parses a valid blueprint', () => {
    const parsed = automationBlueprintSchema.parse(validBlueprint);
    expect(parsed.name).toBe('Invoice sync');
    expect(parsed.steps).toHaveLength(1);
  });

  it('rejects blueprints with an unknown trigger type', () => {
    expect(
      automationBlueprintSchema.safeParse({
        ...validBlueprint,
        trigger: { type: 'teleport', config: {} },
      }).success,
    ).toBe(false);
  });

  it('rejects blueprints without steps', () => {
    expect(automationBlueprintSchema.safeParse({ ...validBlueprint, steps: [] }).success).toBe(
      false,
    );
  });
});

describe('blueprintRevision', () => {
  it('is stable for identical blueprints', () => {
    expect(blueprintRevision(automationBlueprintSchema.parse(validBlueprint))).toBe(
      blueprintRevision(automationBlueprintSchema.parse(validBlueprint)),
    );
  });

  it('ignores readiness and missing requirements but reacts to content', () => {
    const base = automationBlueprintSchema.parse(validBlueprint);
    const notReady = automationBlueprintSchema.parse({
      ...validBlueprint,
      ready: false,
      missingRequirements: ['Which ledger?'],
    });
    const renamed = automationBlueprintSchema.parse({ ...validBlueprint, name: 'Ledger sync' });

    expect(blueprintRevision(base)).toBe(blueprintRevision(notReady));
    expect(blueprintRevision(base)).not.toBe(blueprintRevision(renamed));
  });
});

describe('automationWebhookSlug', () => {
  it('builds a slug from the automation name and id prefix', () => {
    expect(automationWebhookSlug('b7e2c1aa-1234-5678-9abc-def012345678', 'Invoice Sync!')).toBe(
      'invoice-sync-b7e2c1aa',
    );
  });

  it('falls back to a generic slug for symbol-only names', () => {
    expect(automationWebhookSlug('b7e2c1aa-1234', '!!!')).toBe('automation-b7e2c1aa');
  });
});
