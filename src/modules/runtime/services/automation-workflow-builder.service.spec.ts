import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nNodeSchemaError } from '../../../infrastructure/n8n/n8n-node-inventory.service';
import type { AutomationBlueprint } from '../../automations/schemas/automation-blueprint.schema';
import { AutomationPlanReviewService } from './automation-plan-review.service';
import { AutomationWorkflowBuilderService } from './automation-workflow-builder.service';

const blueprint = (overrides: Partial<AutomationBlueprint> = {}): AutomationBlueprint => ({
  ready: true,
  missingRequirements: [],
  name: 'Order sync',
  goal: 'Sync orders',
  summary: 'Syncs',
  description: '',
  trigger: { type: 'webhook', config: {} },
  steps: [
    {
      id: 'S1',
      name: 'Receive order',
      action: 'Receive the order',
      config: {},
      requirementIds: ['R1'],
      expectedOutput: 'order payload',
      nodeHint: { type: 'n8n-nodes-base.webhook', parameters: { path: 'orders' } },
    },
    {
      id: 'S2',
      name: 'Log order',
      action: 'Log the order payload',
      config: {},
      requirementIds: ['R1'],
      nodeHint: {
        type: 'n8n-nodes-base.code',
        parameters: { jsCode: 'return { json: $(' + "'Receive order'" + ').json };' },
      },
    },
  ],
  integrations: [],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
  ...overrides,
});

describe('AutomationWorkflowBuilderService', () => {
  const automations = {
    createFromBlueprint: vi.fn(),
    approve: vi.fn(),
    rollbackToVersion: vi.fn(),
  };
  const agentRuns = { recordArtifacts: vi.fn() };
  const connections = { resolveActiveForScope: vi.fn() };
  const nodeInventory = { describeNodeType: vi.fn(), inventory: vi.fn() };

  const service = () =>
    new AutomationWorkflowBuilderService(
      new AutomationPlanReviewService(),
      automations as never,
      agentRuns as never,
      connections as never,
      nodeInventory as never,
    );

  beforeEach(() => {
    vi.resetAllMocks();
    connections.resolveActiveForScope.mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'https://n8n.example.com',
      apiKey: 'sk',
    });
    nodeInventory.describeNodeType.mockImplementation(async (_conn: unknown, type: string) => ({
      nodeType: type,
      operationVerified: true,
      source: 'harvested',
      inUse: true,
    }));
    nodeInventory.inventory.mockRejectedValue(new Error('inventory unavailable'));
    automations.createFromBlueprint.mockResolvedValue({ id: 'auto-1' });
    automations.approve.mockResolvedValue({
      id: 'auto-1',
      status: 'ACTIVE',
      externalWorkflowId: 'wf-1',
      webhookPath: 'orders-auto',
      version: 1,
      buildable: true,
      readyToRun: true,
      readinessBlockers: [],
    });
  });

  const input = (overrides = {}) => ({
    blueprint: blueprint(),
    scope: { organizationId: 'org-1' },
    runId: 'run-1',
    requirements: [{ id: 'R1', field: 'sync', required: true }],
    ...overrides,
  });

  it('validates structure, nodes and expressions without provisioning', async () => {
    const validation = await service().validateOnly(input());

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.nodeTypes).toEqual(['n8n-nodes-base.webhook', 'n8n-nodes-base.code']);
    expect(automations.createFromBlueprint).not.toHaveBeenCalled();
  });

  it('refuses to build an invalid plan and never touches n8n', async () => {
    nodeInventory.describeNodeType.mockRejectedValue(
      new N8nNodeSchemaError('Unknown n8n node type', 'NODE_NOT_FOUND', {}),
    );

    await expect(
      service().build(
        input({
          blueprint: blueprint({
            steps: [
              {
                id: 'S1',
                name: 'Mystery',
                action: 'Do magic',
                config: {},
                requirementIds: ['R1'],
                nodeHint: { type: 'n8n-nodes-base.hallucinated', parameters: {} },
              },
            ],
          }),
        }),
      ),
    ).rejects.toThrow('failed static validation');
    expect(automations.createFromBlueprint).not.toHaveBeenCalled();
  });

  it('rejects hallucinated node types when the inventory can be read', async () => {
    nodeInventory.describeNodeType.mockRejectedValue(
      new N8nNodeSchemaError('Unknown n8n node type', 'NODE_NOT_FOUND', {}),
    );

    const validation = await service().validateOnly(input());

    expect(validation.valid).toBe(false);
    expect(validation.errors[0].message).toContain('Unknown n8n node type');
  });

  it('does not mistake nested JSON braces for expression delimiters', async () => {
    // Regression: counting {{/}} in raw JSON flagged structural braces.
    const validation = await service().validateOnly(
      input({
        blueprint: blueprint({
          steps: [
            {
              id: 'S1',
              name: 'GET https://example.com',
              action: 'Fetch the page',
              config: {},
              requirementIds: ['R1'],
              nodeHint: {
                type: 'n8n-nodes-base.httpRequest',
                parameters: {
                  url: 'https://example.com',
                  method: 'GET',
                  options: { timeout: 30000 },
                },
              },
            },
            {
              id: 'S2',
              name: 'Capture',
              action: 'Capture fields',
              config: {},
              requirementIds: ['R1'],
              nodeHint: {
                type: 'n8n-nodes-base.code',
                parameters: {
                  jsCode:
                    "return { json: { code: {{ $('GET https://example.com').json.statusCode }} } };",
                },
              },
            },
          ],
        }),
      }),
    );

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it('treats a lone closing brace as literal text, not an expression', async () => {
    const validation = await service().validateOnly(
      input({
        blueprint: blueprint({
          steps: [
            {
              id: 'S1',
              name: 'Note',
              action: 'Leave a note',
              config: {},
              requirementIds: ['R1'],
              nodeHint: {
                type: 'n8n-nodes-base.code',
                parameters: { jsCode: '// done } bye' },
              },
            },
          ],
        }),
      }),
    );

    expect(validation.valid).toBe(true);
  });

  it('rejects step-id references and points at plan names', async () => {
    const validation = await service().validateOnly(
      input({
        blueprint: blueprint({
          steps: [
            {
              id: 'S1',
              name: 'Fetch',
              action: 'Fetch data',
              config: {},
              requirementIds: ['R1'],
              nodeHint: { type: 'n8n-nodes-base.webhook', parameters: {} },
            },
            {
              id: 'S2',
              name: 'Use',
              action: 'Use fetched data',
              config: {},
              requirementIds: ['R1'],
              nodeHint: {
                type: 'n8n-nodes-base.code',
                parameters: { jsCode: 'return {{ $node["S1"].json }};' },
              },
            },
          ],
        }),
      }),
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors[0].message).toContain('not by id');
  });

  it('rejects unbalanced expressions, dangling refs and forward refs', async () => {
    const bad = (parameters: Record<string, unknown>) =>
      blueprint({
        steps: [
          {
            id: 'S1',
            name: 'First',
            action: 'Do first',
            config: {},
            requirementIds: ['R1'],
            nodeHint: { type: 'n8n-nodes-base.code', parameters },
          },
          {
            id: 'S2',
            name: 'Second',
            action: 'Do second',
            config: {},
            requirementIds: ['R1'],
            nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
          },
        ],
      });

    const unbalanced = await service().validateOnly(
      input({ blueprint: bad({ jsCode: '{{ $json.name }' }) }),
    );
    expect(unbalanced.errors.some((e) => e.message.includes('unbalanced'))).toBe(true);

    const dangling = await service().validateOnly(
      input({ blueprint: bad({ jsCode: "{{ $('Nope').json }}" }) }),
    );
    expect(dangling.errors.some((e) => e.message.includes('unknown node'))).toBe(true);

    const forward = await service().validateOnly(
      input({
        blueprint: blueprint({
          steps: [
            {
              id: 'S1',
              name: 'First',
              action: 'Do first',
              config: {},
              requirementIds: ['R1'],
              nodeHint: {
                type: 'n8n-nodes-base.code',
                parameters: { jsCode: "{{ $('Second').json }}" },
              },
            },
            {
              id: 'S2',
              name: 'Second',
              action: 'Do second',
              config: {},
              requirementIds: ['R1'],
              nodeHint: { type: 'n8n-nodes-base.code', parameters: {} },
            },
          ],
        }),
      }),
    );
    expect(forward.errors.some((e) => e.message.includes('runs later'))).toBe(true);
  });

  it('builds through the automations service and records run artifacts', async () => {
    const { automation, validation } = await service().build(input());

    expect(validation.valid).toBe(true);
    expect(automations.createFromBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Order sync' }),
      { organizationId: 'org-1' },
    );
    expect(automations.approve).toHaveBeenCalledWith('auto-1', { organizationId: 'org-1' });
    expect(agentRuns.recordArtifacts).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ workflowId: 'wf-1', workflowVersion: 1 }),
      expect.stringContaining('v1'),
    );
    expect(automation.status).toBe('ACTIVE');
  });

  it('surfaces provisioning failures with the n8n error', async () => {
    automations.approve.mockResolvedValue({
      id: 'auto-1',
      status: 'FAILED',
      lastError: 'credential rejected',
      version: 1,
    });

    await expect(service().build(input())).rejects.toThrow('credential rejected');
  });

  it('returns buildable-but-not-ready instead of throwing on missing credentials', async () => {
    automations.approve.mockResolvedValue({
      id: 'auto-1',
      status: 'ACTIVE',
      externalWorkflowId: 'wf-1',
      webhookPath: 'orders-auto',
      version: 1,
      buildable: true,
      readyToRun: false,
      readinessBlockers: [
        { nodeId: 'S1', integration: 'gmail', credentialStatus: 'NEEDS_CREDENTIAL' },
      ],
    });

    const { automation, validation } = await service().build(input());

    expect(validation.valid).toBe(true);
    expect(automation.buildable).toBe(true);
    expect(automation.readyToRun).toBe(false);
    expect(automation.readinessBlockers).toHaveLength(1);
    expect(agentRuns.recordArtifacts).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        executionResults: expect.objectContaining({ readyToRun: false }),
      }),
      expect.stringContaining('awaiting credentials'),
    );
  });

  it('rolls back through automation versions and records the run', async () => {
    automations.rollbackToVersion.mockResolvedValue({
      id: 'auto-1',
      status: 'ACTIVE',
      externalWorkflowId: 'wf-0',
      webhookPath: 'orders-auto',
      version: 3,
    });

    const rolledBack = await service().rollback('auto-1', 1, { organizationId: 'org-1' }, 'run-1');

    expect(rolledBack.version).toBe(3);
    expect(agentRuns.recordArtifacts).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ workflowVersion: 3 }),
      expect.stringContaining('rolled back'),
    );
  });
});

describe('AutomationWorkflowBuilderService native backstop', () => {
  const automations = {
    createFromBlueprint: vi.fn(),
    approve: vi.fn(),
    rollbackToVersion: vi.fn(),
  };
  const agentRuns = { recordArtifacts: vi.fn() };
  const connections = { resolveActiveForScope: vi.fn() };
  const nodeInventory = { describeNodeType: vi.fn(), inventory: vi.fn() };

  const service = () =>
    new AutomationWorkflowBuilderService(
      new AutomationPlanReviewService(),
      automations as never,
      agentRuns as never,
      connections as never,
      nodeInventory as never,
    );

  const whatsappBlueprint = () =>
    blueprint({
      steps: [
        {
          id: 'S1',
          name: 'Send message',
          action: 'Send the WhatsApp message',
          integration: 'whatsapp',
          config: {},
          requirementIds: ['R1'],
          expectedOutput: 'message id',
          nodeHint: { type: 'n8n-nodes-base.httpRequest', parameters: {} },
        },
      ],
      integrations: ['whatsapp'],
    });

  const whatsappCapability = {
    provider: 'whatsapp',
    displayName: 'WhatsApp',
    source: 'n8n' as const,
    connectionStatus: 'CONNECTED' as const,
    credentialsAvailable: true,
    credentialType: 'whatsAppCloudApi',
    nodeTypes: ['n8n-nodes-base.whatsApp'],
    suggestedNodeType: 'n8n-nodes-base.whatsApp',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    connections.resolveActiveForScope.mockResolvedValue({
      connectionId: 'conn-1',
      baseUrl: 'https://n8n.example.com',
      apiKey: 'sk',
    });
    nodeInventory.describeNodeType.mockImplementation(async (_conn: unknown, type: string) => ({
      nodeType: type,
      operationVerified: true,
      source: 'harvested',
      inUse: true,
    }));
    nodeInventory.inventory.mockResolvedValue({
      nodeTypes: [{ type: 'n8n-nodes-base.whatsApp', typeVersion: 1, inUse: true }],
      dataTables: [],
      dataTablesSupported: false,
    });
  });

  it('fails once (no duplicate) when review already flagged the native violation', async () => {
    const validation = await service().validateOnly({
      blueprint: whatsappBlueprint(),
      scope: { organizationId: 'org-1' },
      requirements: [{ id: 'R1', field: 'send message', required: true }],
      capabilities: [whatsappCapability],
    });

    expect(validation.valid).toBe(false);
    const nativeErrors = validation.errors.filter(
      (e) => e.code === 'NATIVE_NODE_AVAILABLE' || e.message.includes('native'),
    );
    // Review owns the violation; the builder backstop must not double-report.
    expect(nativeErrors).toHaveLength(1);
    expect(nativeErrors[0]?.message).toContain('n8n-nodes-base.whatsApp');
  });

  it('suppresses the backstop on explicit HTTP override', async () => {
    const validation = await service().validateOnly({
      blueprint: whatsappBlueprint(),
      scope: { organizationId: 'org-1' },
      requirements: [{ id: 'R1', field: 'send message', required: true }],
      capabilities: [whatsappCapability],
      genericOverride: { requested: true, type: 'httpRequest' },
    });

    expect(validation.errors.some((e) => e.message.includes('native'))).toBe(false);
  });

  it('allows HTTP for unknown integrations without a native', async () => {
    const validation = await service().validateOnly({
      blueprint: blueprint({
        steps: [
          {
            id: 'S1',
            name: 'Call ledger',
            action: 'POST to the ledger API',
            config: { url: 'https://ledger.example.com/hook' },
            requirementIds: ['R1'],
            expectedOutput: 'receipt',
            nodeHint: { type: 'n8n-nodes-base.httpRequest', parameters: {} },
          },
        ],
        integrations: [],
      }),
      scope: { organizationId: 'org-1' },
      requirements: [{ id: 'R1', field: 'call ledger', required: true }],
    });

    expect(validation.errors.some((e) => e.message.includes('native'))).toBe(false);
  });

  it('builds known native nodes missing from inventory with a verification warning', async () => {
    nodeInventory.describeNodeType.mockRejectedValue(
      new N8nNodeSchemaError('Unknown n8n node type', 'NODE_NOT_FOUND', {}),
    );
    const validation = await service().validateOnly({
      blueprint: blueprint({
        steps: [
          {
            id: 'S1',
            name: 'Watch Gmail',
            action: 'Watch for new Gmail messages',
            integration: 'gmail',
            config: {},
            requirementIds: ['R1'],
            expectedOutput: 'message',
            nodeHint: { type: 'n8n-nodes-base.gmailTrigger', parameters: {} },
          },
        ],
        integrations: ['gmail'],
      }),
      scope: { organizationId: 'org-1' },
      requirements: [{ id: 'R1', field: 'watch gmail', required: true }],
      capabilities: [],
    });

    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.message.includes('building anyway'))).toBe(true);
    expect(validation.nodeTypes).toContain('n8n-nodes-base.gmailTrigger');
  });

  it('still rejects hallucinated nodes for unknown providers', async () => {
    nodeInventory.describeNodeType.mockRejectedValue(
      new N8nNodeSchemaError('Unknown n8n node type', 'NODE_NOT_FOUND', {}),
    );
    const validation = await service().validateOnly({
      blueprint: blueprint({
        steps: [
          {
            id: 'S1',
            name: 'Create customer',
            action: 'Create the customer',
            integration: 'fakecrmpro',
            config: {},
            requirementIds: ['R1'],
            expectedOutput: 'customer id',
            nodeHint: { type: 'n8n-nodes-base.fakeCrmPro', parameters: {} },
          },
        ],
        integrations: ['fakecrmpro'],
      }),
      scope: { organizationId: 'org-1' },
      requirements: [{ id: 'R1', field: 'create customer', required: true }],
      capabilities: [],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.code === 'INVALID_PLAN')).toBe(true);
  });
});
