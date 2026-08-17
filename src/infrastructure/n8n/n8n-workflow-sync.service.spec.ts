import { describe, expect, it, vi } from 'vitest';
import { N8nWorkflowSyncService } from './n8n-workflow-sync.service';

describe('N8nWorkflowSyncService', () => {
  const mockConfig = (overrides: Record<string, unknown> = {}) => ({
    get: vi.fn((key: string) => {
      if (key === 'N8N_API_URL') return 'http://localhost:5678/api/v1';
      if (key === 'N8N_API_KEY') return 'test-n8n-api-key';
      if (key === 'WOOPS_INTER_SERVICE_SECRET') return 'secret-123';
      if (key === 'PORT') return 3000;
      return overrides[key];
    }),
  });

  it('skips sync on bootstrap when API key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config = { get: vi.fn().mockReturnValue(undefined) };
    const service = new N8nWorkflowSyncService(config as never);

    await service.onApplicationBootstrap();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('automatically discovers and provisions missing workflows on startup', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/workflows') && init?.method === 'GET') {
        // Return empty list of existing workflows
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      }
      if (url.endsWith('/workflows') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: 'wf_created_123' }),
        };
      }
      if (url.includes('/activate') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, status: 404 };
    });

    vi.stubGlobal('fetch', fetchMock);

    const mockDb = {
      skill: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { slug: 'search_customer', name: 'Search Customer', description: 'CRM search' },
          ]),
      },
    };

    const service = new N8nWorkflowSyncService(mockConfig() as never, mockDb as never);
    const result = await service.syncAllWorkflows();

    expect(result.provisioned).toBeGreaterThanOrEqual(2); // Inbound Gateway + Skills
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-N8N-API-KEY': 'test-n8n-api-key' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/workflows/wf_created_123/activate',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('activates existing inactive workflows without duplicating them', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/workflows') && init?.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'wf_existing_1', name: 'Woops - Inbound Channel Gateway', active: true },
              { id: 'wf_existing_2', name: 'Woops - search_customer', active: false },
              { id: 'wf_existing_3', name: 'Woops - send_channel_message', active: true },
            ],
          }),
        };
      }
      if (url.endsWith('/workflows') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'wf_created_new' }) };
      }
      if (url.includes('/activate') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: false, status: 404, text: async () => 'Not found' };
    });

    vi.stubGlobal('fetch', fetchMock);

    const mockDb = {
      skill: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const service = new N8nWorkflowSyncService(mockConfig() as never, mockDb as never);
    const result = await service.syncAllWorkflows();

    expect(result.provisioned).toBeGreaterThanOrEqual(1); // Activated search_customer
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/workflows/wf_existing_2/activate',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });
});
