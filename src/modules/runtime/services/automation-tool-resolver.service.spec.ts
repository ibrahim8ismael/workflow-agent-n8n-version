import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationsService } from '../../automations/services/automations.service';
import { AutomationToolResolverService } from './automation-tool-resolver.service';

const automationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'auto-1',
  name: 'Invoice sync',
  description: 'Syncs invoices',
  blueprint: {
    goal: 'Sync paid invoices',
    inputContract: { type: 'object', required: ['invoiceId'] },
    outputContract: {},
  },
  webhookPath: 'invoice-sync-b7e2c1aa',
  connection: {
    id: 'conn-1',
    baseUrl: 'https://client.example.com',
    status: 'ACTIVE',
    deletedAt: null,
  },
  ...overrides,
});

describe('AutomationToolResolverService', () => {
  let automations: { listForToolResolution: ReturnType<typeof vi.fn> };
  let service: AutomationToolResolverService;

  beforeEach(() => {
    vi.clearAllMocks();
    automations = {
      listForToolResolution: vi.fn().mockResolvedValue([automationRow()]),
    };
    service = new AutomationToolResolverService(automations as unknown as AutomationsService);
  });

  it('enumerates ACTIVE automations as n8n tools bound to the client webhook', async () => {
    const tools = await service.listTools({ organizationId: 'org-1' });

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      id: 'invoice-sync-b7e2c1aa',
      slug: 'invoice-sync-b7e2c1aa',
      executionMode: 'n8n',
      sideEffect: true,
      requiresApproval: false,
      binding: { baseUrl: 'https://client.example.com', webhookPath: 'invoice-sync-b7e2c1aa' },
      unavailableReason: undefined,
    });
    expect(automations.listForToolResolution).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('flags automations with an unusable connection as INTEGRATION_UNAVAILABLE', async () => {
    automations.listForToolResolution = vi.fn().mockResolvedValue([
      automationRow({
        connection: { id: 'conn-1', baseUrl: 'https://x', status: 'SUSPENDED', deletedAt: null },
      }),
    ]);

    const tools = await service.listTools({ organizationId: 'org-1' });

    expect(tools[0]?.binding).toBeUndefined();
    expect(tools[0]?.unavailableReason).toBe('INTEGRATION_UNAVAILABLE');
  });

  it('caches per scope with a short TTL', async () => {
    await service.listTools({ organizationId: 'org-1' });
    await service.listTools({ organizationId: 'org-1' });

    expect(automations.listForToolResolution).toHaveBeenCalledTimes(1);

    service.invalidate({ organizationId: 'org-1' });
    await service.listTools({ organizationId: 'org-1' });

    expect(automations.listForToolResolution).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list instead of failing when resolution errors', async () => {
    automations.listForToolResolution = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(service.listTools({ userId: 'user-1' })).resolves.toEqual([]);
  });
});
