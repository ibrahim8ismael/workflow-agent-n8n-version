import { describe, expect, it } from 'vitest';
import type { AutomationBlueprint } from '../../automations/schemas/automation-blueprint.schema';
import { AutomationPlanReviewService } from './automation-plan-review.service';

const blueprint = (overrides: Partial<AutomationBlueprint> = {}): AutomationBlueprint => ({
  ready: true,
  missingRequirements: [],
  name: 'Order sync',
  goal: 'Sync Shopify orders to Zoho',
  summary: 'Syncs new orders',
  description: '',
  trigger: { type: 'webhook', config: {} },
  steps: [
    {
      name: 'Receive order',
      action: 'Receive the new Shopify order',
      integration: 'shopify',
      requirementIds: ['R1'],
      expectedOutput: 'order payload',
      config: {},
      nodeHint: { type: 'n8n-nodes-base.webhook', parameters: {} },
    },
    {
      name: 'Upsert contact',
      action: 'Create or update the Zoho contact',
      integration: 'zoho',
      requirementIds: ['R2'],
      config: {},
      nodeHint: { type: 'n8n-nodes-base.httpRequest', parameters: {} },
    },
  ],
  integrations: ['shopify', 'zoho'],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
  ...overrides,
});

const requirements = [
  { id: 'R1', field: 'receive order', required: true },
  { id: 'R2', field: 'upsert contact', required: true },
  { id: 'R3', field: 'nice report', required: false },
];

describe('AutomationPlanReviewService', () => {
  const service = new AutomationPlanReviewService();

  it('accepts a fully covered plan and assigns stable step ids', () => {
    const result = service.review({ blueprint: blueprint(), requirements });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.blueprint.steps.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(result.coverage).toMatchObject([
      { requirementId: 'R1', stepIds: ['S1'] },
      { requirementId: 'R2', stepIds: ['S2'] },
      { requirementId: 'R3', stepIds: [] },
    ]);
  });

  it('rejects plans with uncovered required requirements', () => {
    const result = service.review({
      blueprint: blueprint({
        steps: [
          {
            name: 'Receive order',
            action: 'Receive the order',
            requirementIds: ['R1'],
            config: {},
            nodeHint: { type: 'n8n-nodes-base.webhook', parameters: {} },
          },
        ],
      }),
      requirements,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toMatchObject([{ code: 'UNCOVERED_REQUIREMENT', requirementId: 'R2' }]);
  });

  it('rejects unknown integrations when capabilities are provided', () => {
    const result = service.review({
      blueprint: blueprint(),
      requirements,
      capabilities: [
        {
          provider: 'shopify',
          displayName: 'Shopify',
          source: 'n8n',
          connectionStatus: 'CONNECTED',
          credentialsAvailable: true,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_INTEGRATION')).toBe(true);
  });

  it('rejects missing triggers and duplicate steps', () => {
    const noTrigger = service.review({
      blueprint: blueprint({ trigger: undefined as never }),
      requirements: [],
    });
    expect(noTrigger.errors.some((e) => e.code === 'MISSING_TRIGGER')).toBe(true);

    const dupes = service.review({
      blueprint: blueprint({
        steps: [
          {
            name: 'Same',
            action: 'Do A',
            config: {},
            nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
          },
          {
            name: 'Same',
            action: 'Do B',
            config: {},
            nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
          },
        ],
      }),
      requirements: [],
    });
    expect(dupes.errors.some((e) => e.code === 'DUPLICATE_STEP')).toBe(true);
  });

  it('warns on unmapped steps, unrepresented conditions and unacknowledged side effects', () => {
    const result = service.review({
      blueprint: blueprint({
        steps: [
          {
            name: 'Delete everything',
            action: 'Delete all old contacts',
            requirementIds: ['R1'],
            config: {},
            nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
          },
        ],
      }),
      requirements: [{ id: 'R1', field: 'cleanup', required: true }],
      conditions: ['only contacts older than a year'],
    });

    expect(result.warnings.some((w) => w.code === 'UNMAPPED_STEP')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'CONDITION_UNREPRESENTED')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'SIDE_EFFECT_UNACKNOWLEDGED')).toBe(true);
  });
});

describe('AutomationPlanReviewService native-node guardrail', () => {
  const service = new AutomationPlanReviewService();

  const whatsappHttp = () =>
    blueprint({
      steps: [
        {
          name: 'Send message',
          action: 'Send the WhatsApp message',
          integration: 'whatsapp',
          requirementIds: ['R1'],
          expectedOutput: 'message id',
          config: {},
          nodeHint: { type: 'n8n-nodes-base.httpRequest', parameters: {} },
        },
      ],
      integrations: ['whatsapp'],
    });

  const connectedWhatsapp = {
    provider: 'whatsapp',
    displayName: 'WhatsApp',
    source: 'n8n' as const,
    connectionStatus: 'CONNECTED' as const,
    credentialsAvailable: true,
    credentialType: 'whatsAppCloudApi',
    nodeTypes: ['n8n-nodes-base.whatsApp'],
    suggestedNodeType: 'n8n-nodes-base.whatsApp',
  };

  it('errors NATIVE_NODE_AVAILABLE for HTTP with a proven native node', () => {
    const result = service.review({
      blueprint: whatsappHttp(),
      requirements: [{ id: 'R1', field: 'send message', required: true }],
      capabilities: [connectedWhatsapp],
      instanceNodeTypes: ['n8n-nodes-base.whatsApp'],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toMatchObject([{ code: 'NATIVE_NODE_AVAILABLE' }]);
    expect(result.errors[0]?.message).toContain('n8n-nodes-base.whatsApp');
  });

  it('suppresses the native error on explicit HTTP override', () => {
    const result = service.review({
      blueprint: whatsappHttp(),
      requirements: [{ id: 'R1', field: 'send message', required: true }],
      capabilities: [connectedWhatsapp],
      instanceNodeTypes: ['n8n-nodes-base.whatsApp'],
      genericOverride: { requested: true, type: 'httpRequest' },
    });

    expect(result.errors.some((e) => e.code === 'NATIVE_NODE_AVAILABLE')).toBe(false);
  });

  it('allows HTTP for custom APIs with no capability', () => {
    const result = service.review({
      blueprint: blueprint({
        steps: [
          {
            name: 'Call ledger',
            action: 'POST the payload to the ledger API',
            requirementIds: ['R1'],
            expectedOutput: 'receipt',
            config: {},
            nodeHint: { type: 'n8n-nodes-base.httpRequest', parameters: {} },
          },
        ],
        integrations: [],
      }),
      requirements: [{ id: 'R1', field: 'call ledger', required: true }],
      capabilities: [connectedWhatsapp],
    });

    expect(result.errors.some((e) => e.code === 'NATIVE_NODE_AVAILABLE')).toBe(false);
  });

  it('errors for Code replacing a proven native node', () => {
    const result = service.review({
      blueprint: blueprint({
        steps: [
          {
            name: 'Create contact',
            action: 'Create the HubSpot contact',
            integration: 'hubspot',
            requirementIds: ['R1'],
            expectedOutput: 'contact id',
            config: {},
            nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
          },
        ],
        integrations: ['hubspot'],
      }),
      requirements: [{ id: 'R1', field: 'create contact', required: true }],
      capabilities: [
        {
          provider: 'hubspot',
          displayName: 'HubSpot',
          source: 'n8n',
          connectionStatus: 'CONNECTED',
          credentialsAvailable: true,
          nodeTypes: ['n8n-nodes-base.hubSpot'],
        },
      ],
    });

    expect(result.errors).toMatchObject([{ code: 'NATIVE_NODE_AVAILABLE' }]);
  });

  it('warns instead of erroring when the instance is unreadable', () => {
    const result = service.review({
      blueprint: whatsappHttp(),
      requirements: [{ id: 'R1', field: 'send message', required: true }],
      capabilities: [{ ...connectedWhatsapp, nodeTypes: [] }],
    });

    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.code === 'NATIVE_NODE_AVAILABLE')).toBe(false);
    expect(
      result.warnings.some((w) => w.code === 'UNMAPPED_STEP' && w.message.includes('native node')),
    ).toBe(true);
  });

  it('allows pure transformation Code steps', () => {
    const result = service.review({
      blueprint: blueprint({
        steps: [
          {
            name: 'Normalize payload',
            action: 'Reshape the order payload',
            requirementIds: ['R1'],
            expectedOutput: 'normalized payload',
            config: {},
            nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
          },
        ],
        integrations: [],
      }),
      requirements: [{ id: 'R1', field: 'normalize', required: true }],
      capabilities: [connectedWhatsapp],
    });

    expect(result.errors.some((e) => e.code === 'NATIVE_NODE_AVAILABLE')).toBe(false);
  });
});
