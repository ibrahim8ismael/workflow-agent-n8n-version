import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nClientApiError } from './n8n-client-api.service';
import { N8nNodeInventoryService, N8nNodeSchemaError } from './n8n-node-inventory.service';

const connection = { baseUrl: 'http://localhost:7777', apiKey: 'key' };

const clientApi = {
  listWorkflowDetails: vi.fn(),
  listDataTables: vi.fn(),
};

const service = () => new N8nNodeInventoryService(clientApi as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('N8nNodeInventoryService', () => {
  it('harvests node types, versions, parameter samples and credentials from the instance', async () => {
    clientApi.listWorkflowDetails.mockResolvedValue([
      {
        nodes: [
          {
            type: 'n8n-nodes-base.whatsApp',
            typeVersion: 1,
            parameters: { operation: 'send' },
            credentials: { whatsAppCloudApi: { id: 'cred-1', name: 'WA' } },
          },
          { type: 'n8n-nodes-base.webhook', typeVersion: 2, parameters: { path: 'x' } },
        ],
      },
      {
        nodes: [
          {
            type: 'n8n-nodes-base.whatsApp',
            typeVersion: 2,
            credentials: { whatsAppCloudApi: { id: 'cred-2', name: 'WA2' } },
          },
        ],
      },
    ]);
    clientApi.listDataTables.mockResolvedValue([{ id: 'dt-1', name: 'log', columns: [] }]);

    const inventory = await service().inventory(connection);

    const whatsApp = inventory.nodeTypes.find((n) => n.type === 'n8n-nodes-base.whatsApp');
    expect(whatsApp).toMatchObject({ typeVersion: 2, inUse: true });
    expect(whatsApp?.credentials).toMatchObject({
      whatsAppCloudApi: { id: 'cred-2', name: 'WA2' },
    });
    expect(inventory.nodeTypes.find((n) => n.type === 'n8n-nodes-base.webhook')?.inUse).toBe(true);
    // Structural seed present even when not observed in workflows.
    expect(
      inventory.nodeTypes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger'),
    ).toMatchObject({
      inUse: false,
    });
    expect(inventory.dataTables).toEqual([{ id: 'dt-1', name: 'log', columns: [] }]);
    expect(inventory.dataTablesSupported).toBe(true);
  });

  it('treats a 404 data-tables endpoint as unsupported (older n8n)', async () => {
    clientApi.listWorkflowDetails.mockResolvedValue([]);
    clientApi.listDataTables.mockRejectedValue(
      new N8nClientApiError('n8n API returned HTTP 404', 'API_ERROR', 404),
    );

    const inventory = await service().inventory(connection);

    expect(inventory.dataTables).toEqual([]);
    expect(inventory.dataTablesSupported).toBe(false);
    expect(inventory.nodeTypes.length).toBeGreaterThan(0);
  });

  it('keeps designing when the instance cannot be read (seed-only inventory)', async () => {
    clientApi.listWorkflowDetails.mockRejectedValue(new Error('boom'));
    clientApi.listDataTables.mockRejectedValue(new Error('boom'));

    const inventory = await service().inventory(connection);

    expect(inventory.nodeTypes.length).toBeGreaterThan(0);
    expect(inventory.nodeTypes.every((n) => n.inUse === false)).toBe(true);
    expect(inventory.dataTablesSupported).toBe(false);
  });

  it('caches the inventory for repeated design turns', async () => {
    clientApi.listWorkflowDetails.mockResolvedValue([]);
    clientApi.listDataTables.mockResolvedValue([]);
    const svc = service();

    await svc.inventory(connection);
    await svc.inventory(connection);

    expect(clientApi.listWorkflowDetails).toHaveBeenCalledTimes(1);
    expect(clientApi.listDataTables).toHaveBeenCalledTimes(1);

    svc.invalidate(connection);
    await svc.inventory(connection);
    expect(clientApi.listWorkflowDetails).toHaveBeenCalledTimes(2);
  });

  describe('describeNodeType', () => {
    beforeEach(() => {
      clientApi.listWorkflowDetails.mockResolvedValue([
        {
          nodes: [
            {
              type: 'n8n-nodes-base.slack',
              typeVersion: 2.2,
              parameters: { resource: 'message', operation: 'send', channel: 'C1' },
              credentials: { slackOAuth2Api: { id: 'cred-9', name: 'Slack' } },
            },
          ],
        },
      ]);
      clientApi.listDataTables.mockResolvedValue([]);
    });

    it('returns the curated schema for structural nodes', async () => {
      const schema = await service().describeNodeType(connection, 'n8n-nodes-base.code');

      expect(schema).toMatchObject({
        nodeType: 'n8n-nodes-base.code',
        required: ['jsCode'],
        operationVerified: true,
        source: 'curated',
      });
    });

    it('resolves short names and verifies known operations', async () => {
      const schema = await service().describeNodeType(connection, 'slack', 'send');

      expect(schema).toMatchObject({
        nodeType: 'n8n-nodes-base.slack',
        operation: 'send',
        operationVerified: true,
        source: 'curated',
      });
      // Credential TYPE names only — never ids.
      expect(schema.credentials).toEqual(['slackOAuth2Api']);
      expect(schema.parametersObserved).toMatchObject({ operation: 'send' });
    });

    it('flags undocumented operations instead of failing the build', async () => {
      const schema = await service().describeNodeType(connection, 'slack', 'futureOp');

      expect(schema.operationVerified).toBe(false);
      expect(schema.operations).toContain('send');
    });

    it('rejects operations on trigger nodes', async () => {
      await expect(service().describeNodeType(connection, 'webhook', 'send')).rejects.toMatchObject(
        {
          name: 'N8nNodeSchemaError',
          code: 'OPERATION_NOT_SUPPORTED',
        },
      );
    });

    it('rejects unknown node types with the available list', async () => {
      const error = await service()
        .describeNodeType(connection, 'n8n-nodes-base.hallucinated')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(N8nNodeSchemaError);
      expect(error as N8nNodeSchemaError).toMatchObject({ code: 'NODE_NOT_FOUND' });
      const details = (error as N8nNodeSchemaError).details as { available: string[] };
      expect(details.available).toContain('n8n-nodes-base.slack');
    });
  });
});
