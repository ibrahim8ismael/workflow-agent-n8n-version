import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nClientApiError, N8nClientApiService } from './n8n-client-api.service';

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const connection = { baseUrl: 'https://n8n.client.example.com', apiKey: 'sk-client-key' };
const PUBLIC_IPV4 = [{ address: '93.184.216.34', family: 4 }];

const mockConfig = () => ({ get: vi.fn((key: string) => (key === 'NODE_ENV' ? 'test' : 5000)) });

const okJson = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: vi.fn().mockReturnValue('application/json') },
  json: vi.fn().mockResolvedValue(data),
});

describe('N8nClientApiService', () => {
  beforeEach(() => {
    lookupMock.mockResolvedValue(PUBLIC_IPV4);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJson({ data: [{ id: 'wf_1', name: 'Flow', active: true }] })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('verifies a connection by listing workflows with the API key header', async () => {
    const service = new N8nClientApiService(mockConfig() as never);
    await expect(service.verify(connection)).resolves.toEqual({ ok: true });

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('https://n8n.client.example.com/api/v1/workflows?limit=1');
    expect(init.headers).toMatchObject({ 'X-N8N-API-KEY': 'sk-client-key' });
  });

  it('lists and unwraps workflows', async () => {
    const service = new N8nClientApiService(mockConfig() as never);
    const workflows = await service.listWorkflows(connection);
    expect(workflows).toEqual([{ id: 'wf_1', name: 'Flow', active: true }]);
  });

  it('creates and activates workflows', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(okJson({ id: 'wf_new' }))
      .mockResolvedValueOnce(okJson({ success: true }));

    const service = new N8nClientApiService(mockConfig() as never);
    const created = await service.createWorkflow(connection, { name: 'Auto' });
    await expect(service.activateWorkflow(connection, created.id)).resolves.toBeUndefined();

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://n8n.client.example.com/api/v1/workflows',
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://n8n.client.example.com/api/v1/workflows/wf_new/activate',
    );
  });

  it('maps unresolvable hosts to UNREACHABLE before any request', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    const service = new N8nClientApiService(mockConfig() as never);
    await expect(service.verify(connection)).rejects.toMatchObject({ code: 'UNREACHABLE' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('maps 401/403 to INVALID_CREDENTIALS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: vi.fn() }));
    const service = new N8nClientApiService(mockConfig() as never);
    await expect(service.verify(connection)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
    });
  });

  it('maps network failures to UNREACHABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const service = new N8nClientApiService(mockConfig() as never);
    await expect(service.verify(connection)).rejects.toMatchObject({
      code: 'UNREACHABLE',
    });
  });

  it('maps other non-2xx to API_ERROR with status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: 'internal' }),
      }),
    );
    const service = new N8nClientApiService(mockConfig() as never);
    await expect(service.verify(connection)).rejects.toMatchObject({
      code: 'API_ERROR',
      statusCode: 500,
    });
  });
});

describe('N8nClientApiService SSRF guard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const serviceIn = (env: string) => {
    const config = { get: vi.fn((key: string) => (key === 'NODE_ENV' ? env : 5000)) };
    return new N8nClientApiService(config as never);
  };

  it('blocks private IPv4 targets', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const service = serviceIn('production');
    await expect(service.listWorkflows(connection)).rejects.toMatchObject({
      code: 'API_ERROR',
      message: expect.stringContaining('private network'),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('blocks link-local / metadata addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const service = serviceIn('production');
    await expect(service.listWorkflows(connection)).rejects.toBeInstanceOf(N8nClientApiError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('blocks private IPv6 targets', async () => {
    lookupMock.mockResolvedValue([{ address: 'fd00::1', family: 6 }]);
    const service = serviceIn('production');
    await expect(service.listWorkflows(connection)).rejects.toBeInstanceOf(N8nClientApiError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('allows public IPs through', async () => {
    lookupMock.mockResolvedValue(PUBLIC_IPV4);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [] })));
    const service = serviceIn('production');
    await expect(service.listWorkflows(connection)).resolves.toEqual([]);
  });

  it('rejects plain http to non-localhost in production before any request', async () => {
    lookupMock.mockResolvedValue(PUBLIC_IPV4);
    const service = serviceIn('production');
    await expect(
      service.listWorkflows({ baseUrl: 'http://n8n.client.example.com', apiKey: 'k' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Plain HTTP') });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('allows http + private loopback for localhost connections outside production', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ data: [] })));
    const service = serviceIn('development');
    await expect(
      service.listWorkflows({ baseUrl: 'http://localhost:5678', apiKey: 'k' }),
    ).resolves.toEqual([]);
  });

  it('still blocks private addresses on localhost hostnames in production', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const service = serviceIn('production');
    await expect(
      service.listWorkflows({ baseUrl: 'http://localhost:5678', apiKey: 'k' }),
    ).rejects.toBeInstanceOf(N8nClientApiError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('N8nClientApiService.extractWebhookPaths', () => {
  it('extracts webhook method and path from workflow nodes', () => {
    const detail = {
      id: 'wf_1',
      name: 'Flow',
      active: true,
      nodes: [
        {
          type: 'n8n-nodes-base.webhook',
          parameters: { httpMethod: 'POST', path: 'auto-123' },
        },
        { type: 'n8n-nodes-base.code', parameters: {} },
        {
          type: 'n8n-nodes-base.webhook',
          parameters: { path: '' }, // filtered out (empty path)
        },
      ],
    };
    expect(N8nClientApiService.extractWebhookPaths(detail)).toEqual([
      { method: 'POST', path: 'auto-123' },
    ]);
  });
});
