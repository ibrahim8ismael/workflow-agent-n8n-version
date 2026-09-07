import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nClientApiError } from './n8n-client-api.service';
import { N8nNodeInventoryService } from './n8n-node-inventory.service';

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
});
