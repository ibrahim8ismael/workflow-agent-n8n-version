import { describe, expect, it, vi } from 'vitest';
import type { AutomationBlueprint } from '../../modules/automations/schemas/automation-blueprint.schema';
import { N8nClientApiService } from './n8n-client-api.service';
import type { N8nInstanceInventory } from './n8n-node-inventory.service';
import { N8nProvisionerService } from './n8n-provisioner.service';

const blueprint: AutomationBlueprint = {
  ready: true,
  missingRequirements: [],
  name: 'Invoice sync',
  goal: 'Sync paid invoices to the ledger',
  summary: 'Fetches paid invoices daily.',
  description: '',
  trigger: { type: 'schedule', config: {} },
  steps: [
    { name: 'Fetch invoices', action: 'Fetch paid invoices', integration: 'stripe', config: {} },
    { name: 'Record ledger', action: 'Create ledger rows', config: {} },
  ],
  integrations: ['stripe'],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
};

type WorkflowPayload = {
  nodes: Array<{
    type: string;
    name: string;
    typeVersion?: number;
    parameters?: Record<string, unknown>;
    credentials?: Record<string, { id: string; name: string }>;
  }>;
  connections: Record<string, { main: Array<Array<{ node: string }>> }>;
};

const findNode = (payload: WorkflowPayload, type: string) =>
  payload.nodes.filter((node) => node.type === type);

describe('N8nProvisionerService', () => {
  const clientApi = {
    createWorkflow: vi.fn().mockResolvedValue({ id: 'wf-123' }),
    activateWorkflow: vi.fn().mockResolvedValue(undefined),
    getWorkflow: vi.fn().mockResolvedValue({
      id: 'wf-123',
      name: 'Woops - Invoice sync',
      active: true,
      nodes: [
        {
          type: 'n8n-nodes-base.webhook',
          parameters: { httpMethod: 'POST', path: 'invoice-sync-b7e2c1aa' },
        },
      ],
    }),
    listDataTables: vi.fn().mockResolvedValue([]),
    createDataTable: vi.fn().mockResolvedValue({ id: 'dt-1', name: 'ledger' }),
  } as unknown as N8nClientApiService;

  it('creates and activates a workflow, binding the webhook path', async () => {
    const service = new N8nProvisionerService(clientApi);

    const result = await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint,
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    expect(result).toEqual({
      externalWorkflowId: 'wf-123',
      webhookPath: 'invoice-sync-b7e2c1aa',
      dataTableIds: {},
    });
    expect(clientApi.createWorkflow).toHaveBeenCalledWith(
      { baseUrl: 'https://client.example.com', apiKey: 'key' },
      expect.objectContaining({ name: expect.stringContaining('Invoice sync') }),
    );
    expect(clientApi.activateWorkflow).toHaveBeenCalledWith(
      { baseUrl: 'https://client.example.com', apiKey: 'key' },
      'wf-123',
    );
  });

  it('generates a dual-trigger (schedule + webhook) → step nodes → respond chain', async () => {
    const service = new N8nProvisionerService(clientApi);

    const result = await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint,
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls[0][1] as WorkflowPayload;
    const schedule = findNode(payload, 'n8n-nodes-base.scheduleTrigger');
    const webhook = findNode(payload, 'n8n-nodes-base.webhook');
    const steps = findNode(payload, 'n8n-nodes-base.code');
    const respond = findNode(payload, 'n8n-nodes-base.respondToWebhook');

    expect(schedule).toHaveLength(1);
    expect(webhook).toHaveLength(1);
    expect(steps).toHaveLength(2);
    expect(respond).toHaveLength(1);

    // Both triggers feed the first step (dual-trigger contract).
    expect(payload.connections[webhook[0]!.name].main[0][0].node).toBe(steps[0]!.name);
    expect(payload.connections[schedule[0]!.name].main[0][0].node).toBe(steps[0]!.name);
    // Step chain → respond.
    expect(payload.connections[steps[0]!.name].main[0][0].node).toBe(steps[1]!.name);
    expect(payload.connections[steps[1]!.name].main[0][0].node).toBe(respond[0]!.name);
    expect(result.webhookPath).toContain('invoice-sync');
  });

  it('marks generated step nodes with TODO markers from the blueprint', async () => {
    const service = new N8nProvisionerService(clientApi);

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint,
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls[0][1] as WorkflowPayload;
    const codeNodes = findNode(payload, 'n8n-nodes-base.code');
    expect(codeNodes[0]?.parameters?.jsCode).toContain('TODO');
    expect(codeNodes[0]?.parameters?.jsCode).toContain('Fetch paid invoices');
  });

  it('maps trigger config onto the schedule interval rule', async () => {
    const service = new N8nProvisionerService(clientApi);

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: {
        ...blueprint,
        trigger: { type: 'schedule', config: { every: 10, unit: 'minutes' } },
      },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    const schedule = findNode(payload, 'n8n-nodes-base.scheduleTrigger')[0]!;
    expect(schedule.parameters).toMatchObject({
      rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] },
    });
  });

  it('supports cron expressions and daily/hourly units', async () => {
    const service = new N8nProvisionerService(clientApi);

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: { ...blueprint, trigger: { type: 'schedule', config: { cron: '0 9 * * 1' } } },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    const schedule = findNode(payload, 'n8n-nodes-base.scheduleTrigger')[0]!;
    expect(schedule.parameters).toMatchObject({
      rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1' }] },
    });
  });

  it('provisions nodeHint steps as real n8n nodes and reuses instance credentials', async () => {
    const service = new N8nProvisionerService(clientApi);
    const instance: N8nInstanceInventory = {
      nodeTypes: [
        {
          type: 'n8n-nodes-base.whatsApp',
          typeVersion: 1,
          credentials: { whatsAppCloudApi: { id: 'cred-9', name: 'My WhatsApp' } },
          inUse: true,
        },
      ],
      dataTables: [],
      dataTablesSupported: true,
    };

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: {
        ...blueprint,
        trigger: { type: 'webhook', config: {} },
        steps: [
          {
            name: 'Send WhatsApp',
            action: 'Send a WhatsApp message',
            integration: 'whatsapp',
            config: { to: '+212600000000', message: 'hello from Jaafar' },
            nodeHint: {
              type: 'n8n-nodes-base.whatsApp',
              typeVersion: 1,
              parameters: {
                operation: 'send',
                recipientPhoneNumber: '+212600000000',
                textBody: 'hello from Jaafar',
              },
            },
          },
        ],
      },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
      instance,
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    const whatsApp = findNode(payload, 'n8n-nodes-base.whatsApp')[0]!;
    expect(whatsApp.typeVersion).toBe(1);
    expect(whatsApp.parameters).toMatchObject({
      operation: 'send',
      textBody: 'hello from Jaafar',
    });
    expect(whatsApp.credentials).toEqual({
      whatsAppCloudApi: { id: 'cred-9', name: 'My WhatsApp' },
    });
  });

  it('creates missing data tables and injects real dataTableId into dataTable nodes', async () => {
    const service = new N8nProvisionerService(clientApi);
    const instance: N8nInstanceInventory = {
      nodeTypes: [],
      dataTables: [{ id: 'dt-existing', name: 'existing_table' }],
      dataTablesSupported: true,
    };

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: {
        ...blueprint,
        trigger: { type: 'schedule', config: { every: 10, unit: 'minutes' } },
        dataTables: [{ name: 'existing_table', columns: [{ name: 'a', type: 'string' }] }],
        steps: [
          {
            name: 'Log row',
            action: 'Insert ledger row',
            integration: 'dataTable',
            config: {},
            nodeHint: {
              type: 'n8n-nodes-base.dataTable',
              typeVersion: 1,
              parameters: { operation: 'insert', tableName: 'existing_table' },
            },
          },
        ],
      },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
      instance,
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    const dataTable = findNode(payload, 'n8n-nodes-base.dataTable')[0]!;
    expect(dataTable.parameters).toMatchObject({
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: 'dt-existing' },
    });
    expect(dataTable.parameters).not.toHaveProperty('tableName');
    expect(clientApi.createDataTable).not.toHaveBeenCalled();
  });

  it('creates brand-new data tables via the API before pushing the workflow', async () => {
    const service = new N8nProvisionerService(clientApi);
    const instance: N8nInstanceInventory = {
      nodeTypes: [],
      dataTables: [],
      dataTablesSupported: true,
    };

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: {
        ...blueprint,
        trigger: { type: 'schedule', config: { every: 10, unit: 'minutes' } },
        dataTables: [
          {
            name: 'sent_log',
            columns: [
              { name: 'text', type: 'string' },
              { name: 'sent_at', type: 'date' },
            ],
          },
        ],
        steps: [
          {
            name: 'Log message',
            action: 'Insert log row',
            config: {},
            nodeHint: {
              type: 'n8n-nodes-base.dataTable',
              typeVersion: 1,
              parameters: { operation: 'insert', tableName: 'sent_log' },
            },
          },
        ],
      },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
      instance,
    });

    expect(clientApi.createDataTable).toHaveBeenCalledWith(
      { baseUrl: 'https://client.example.com', apiKey: 'key' },
      {
        name: 'sent_log',
        columns: [
          { name: 'text', type: 'string' },
          { name: 'sent_at', type: 'date' },
        ],
      },
    );
    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    const dataTable = findNode(payload, 'n8n-nodes-base.dataTable')[0]!;
    expect(dataTable.parameters).toMatchObject({
      dataTableId: { __rl: true, mode: 'id', value: 'dt-1' },
    });
  });

  it('falls back to a Code node when a step has no hint and no url', async () => {
    const service = new N8nProvisionerService(clientApi);

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: {
        ...blueprint,
        trigger: { type: 'webhook', config: {} },
        steps: [{ name: 'Do work', action: 'Do the work', config: {} }],
      },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    expect(findNode(payload, 'n8n-nodes-base.code')).toHaveLength(1);
  });

  it('maps url-carrying steps to a generic HTTP node', async () => {
    const service = new N8nProvisionerService(clientApi);

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint: {
        ...blueprint,
        trigger: { type: 'webhook', config: {} },
        steps: [
          {
            name: 'Call CRM',
            action: 'POST to CRM API',
            integration: 'crm',
            config: { url: 'https://crm.example.com/api', method: 'POST' },
          },
        ],
      },
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls.at(-1)![1] as WorkflowPayload;
    const http = findNode(payload, 'n8n-nodes-base.httpRequest')[0]!;
    expect(http.parameters).toMatchObject({ method: 'POST', url: 'https://crm.example.com/api' });
  });
});
