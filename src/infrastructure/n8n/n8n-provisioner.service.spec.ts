import { describe, expect, it, vi } from 'vitest';
import type { AutomationBlueprint } from '../../modules/automations/schemas/automation-blueprint.schema';
import { N8nClientApiService } from './n8n-client-api.service';
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
  } as unknown as N8nClientApiService;

  it('creates and activates a workflow, binding the webhook path', async () => {
    const service = new N8nProvisionerService(clientApi);

    const result = await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint,
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    expect(result).toEqual({ externalWorkflowId: 'wf-123', webhookPath: 'invoice-sync-b7e2c1aa' });
    expect(clientApi.createWorkflow).toHaveBeenCalledWith(
      { baseUrl: 'https://client.example.com', apiKey: 'key' },
      expect.objectContaining({ name: expect.stringContaining('Invoice sync') }),
    );
    expect(clientApi.activateWorkflow).toHaveBeenCalledWith(
      { baseUrl: 'https://client.example.com', apiKey: 'key' },
      'wf-123',
    );
  });

  it('generates a webhook → step nodes → respond chain', async () => {
    const service = new N8nProvisionerService(clientApi);

    const result = await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint,
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls[0][1] as {
      nodes: Array<{ type: string; name: string }>;
      connections: Record<string, { main: Array<Array<{ node: string }>> }>;
    };
    const types = payload.nodes.map((node) => node.type);

    expect(types[0]).toBe('n8n-nodes-base.webhook');
    expect(types.at(-1)).toBe('n8n-nodes-base.respondToWebhook');
    expect(types.filter((type) => type === 'n8n-nodes-base.code')).toHaveLength(2);
    // Chain is fully connected: webhook → step1 → step2 → respond
    expect(payload.connections[payload.nodes[0].name].main[0][0].node).toBe(payload.nodes[1].name);
    expect(result.webhookPath).toContain('invoice-sync');
  });

  it('marks generated step nodes with TODO markers from the blueprint', async () => {
    const service = new N8nProvisionerService(clientApi);

    await service.provision({
      automationId: 'b7e2c1aa-1234-5678',
      blueprint,
      connection: { baseUrl: 'https://client.example.com', apiKey: 'key' },
    });

    const payload = vi.mocked(clientApi.createWorkflow).mock.calls[0][1] as {
      nodes: Array<{ type: string; name: string; parameters?: { jsCode?: string } }>;
    };
    const codeNodes = payload.nodes.filter((node) => node.type === 'n8n-nodes-base.code');
    expect(codeNodes[0]?.parameters?.jsCode).toContain('TODO');
    expect(codeNodes[0]?.parameters?.jsCode).toContain('Fetch paid invoices');
  });
});
