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
      requirementIds: ['R1'],
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

  it('parses nodeHint steps with real n8n node types (free-form, no allowlist)', () => {
    const parsed = automationBlueprintSchema.parse({
      ...validBlueprint,
      steps: [
        {
          ...validBlueprint.steps[0],
          nodeHint: {
            type: 'n8n-nodes-base.whatsApp',
            typeVersion: 1,
            parameters: { operation: 'send', textBody: 'hello from Jaafar' },
          },
        },
      ],
    });
    expect(parsed.steps[0]?.nodeHint).toMatchObject({ type: 'n8n-nodes-base.whatsApp' });
  });

  it('accepts non-base packages (langchain, community nodes)', () => {
    const parsed = automationBlueprintSchema.parse({
      ...validBlueprint,
      steps: [
        {
          ...validBlueprint.steps[0],
          nodeHint: { type: '@n8n/n8n-nodes-langchain.agent', parameters: {} },
        },
      ],
    });
    expect(parsed.steps[0]?.nodeHint?.type).toBe('@n8n/n8n-nodes-langchain.agent');
  });

  it('rejects node types that are not package.TypeName shapes', () => {
    expect(
      automationBlueprintSchema.safeParse({
        ...validBlueprint,
        steps: [{ ...validBlueprint.steps[0], nodeHint: { type: 'whatsApp', parameters: {} } }],
      }).success,
    ).toBe(false);
  });

  it('parses declared data tables with typed columns', () => {
    const parsed = automationBlueprintSchema.parse({
      ...validBlueprint,
      dataTables: [
        {
          name: 'sent_log',
          columns: [
            { name: 'text', type: 'string' },
            { name: 'sent_at', type: 'date' },
          ],
        },
      ],
    });
    expect(parsed.dataTables?.[0]?.name).toBe('sent_log');
    expect(parsed.dataTables?.[0]?.columns[1]).toEqual({ name: 'sent_at', type: 'date' });
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
