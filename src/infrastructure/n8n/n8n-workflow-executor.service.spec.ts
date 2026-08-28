import { describe, expect, it, vi } from 'vitest';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

describe('N8nWorkflowExecutorService', () => {
  const secret = 'super-secret-inter-service-key-123';

  const mockConfig = (overrides: Record<string, unknown> = {}) => ({
    get: vi.fn((key: string) => {
      if (key in overrides) return overrides[key];
      if (key === 'N8N_WEBHOOK_URL') return 'https://n8n.example.com/webhook';
      if (key === 'WOOPS_INTER_SERVICE_SECRET') return secret;
      if (key === 'N8N_TIMEOUT_MS') return 1000;
      if (key === 'N8N_MAX_RETRIES') return 0;
      return undefined;
    }),
  });

  it('keeps webhook configuration inside the infrastructure adapter and signs requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ result: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(mockConfig() as never);
    await expect(
      service.execute({
        workflow: 'support',
        input: { query: 'hello' },
        userId: 'user-1',
        organizationId: 'org-1',
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ result: 'ok' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.example.com/webhook/support',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Woops-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
          'X-Woops-Timestamp': expect.any(String),
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('unwraps structured envelope responses containing success and data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { customerId: 'cust_123', name: 'Alice' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(mockConfig() as never);
    const result = await service.execute({
      workflow: 'search_customer',
      input: { email: 'alice@example.com' },
      timeoutMs: 1_000,
    });

    expect(result).toEqual({ customerId: 'cust_123', name: 'Alice' });
    vi.unstubAllGlobals();
  });

  it('classifies missing configuration without attempting a request', async () => {
    const config = { get: vi.fn().mockReturnValue(undefined) };
    const service = new N8nWorkflowExecutorService(config as never);

    await expect(
      service.execute({ workflow: 'support', input: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ retryable: false, message: 'N8N_WEBHOOK_URL is not configured' });
  });

  it('passes the stable idempotency key to n8n in headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ result: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(mockConfig() as never);
    await service.execute({
      workflow: 'support',
      input: {},
      timeoutMs: 1_000,
      idempotencyKey: 'run-1:plan-step-1:v1',
    });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'run-1:plan-step-1:v1' }),
      }),
    );
    vi.unstubAllGlobals();
  });

  // --- Characterization tests (PLAN Step 0): lock the contract before client-n8n refactor ---

  it('retries retryable HTTP 500 failures with backoff and then succeeds', async () => {
    const okResponse = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ result: 'ok' }),
    };
    const serverErrorResponse = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('boom'),
      json: vi.fn().mockResolvedValue({}),
      headers: { get: vi.fn().mockReturnValue('application/json') },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(serverErrorResponse)
      .mockResolvedValue(okResponse);
    vi.stubGlobal('fetch', fetchMock);

    const config = mockConfig({ N8N_MAX_RETRIES: 2 });
    const service = new N8nWorkflowExecutorService(config as never);
    await expect(
      service.execute({ workflow: 'support', input: {}, timeoutMs: 1_000 }),
    ).resolves.toEqual({ result: 'ok' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('does not retry non-retryable HTTP 4xx failures', async () => {
    const badRequestResponse = {
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('bad request'),
      json: vi.fn().mockResolvedValue({ message: 'invalid payload' }),
      headers: { get: vi.fn().mockReturnValue('application/json') },
    };
    const fetchMock = vi.fn().mockResolvedValue(badRequestResponse);
    vi.stubGlobal('fetch', fetchMock);

    const config = mockConfig({ N8N_MAX_RETRIES: 3 });
    const service = new N8nWorkflowExecutorService(config as never);
    await expect(
      service.execute({ workflow: 'support', input: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ retryable: false, statusCode: 400 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('classifies network errors as retryable and exhausts retries before failing', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const config = mockConfig({ N8N_MAX_RETRIES: 2 });
    const service = new N8nWorkflowExecutorService(config as never);
    await expect(
      service.execute({ workflow: 'support', input: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      name: 'N8nWorkflowError',
      message: expect.stringContaining('network down'),
    });

    // initial attempt + 2 retries
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});

describe('N8nWorkflowExecutorService — client binding (PLAN Step 10)', () => {
  const secret = 'super-secret-inter-service-key-123';

  const mockConfig = (overrides: Record<string, unknown> = {}) => ({
    get: vi.fn((key: string) => {
      if (key in overrides) return overrides[key];
      if (key === 'WOOPS_INTER_SERVICE_SECRET') return secret;
      if (key === 'N8N_TIMEOUT_MS') return 1000;
      if (key === 'N8N_MAX_RETRIES') return 0;
      return undefined;
    }),
  });

  it('targets the client webhook via the binding instead of platform env', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ result: 'bound' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(mockConfig() as never);
    await expect(
      service.execute({
        workflow: 'invoice-sync-b7e2c1aa',
        input: { invoiceId: 'inv-1' },
        binding: { baseUrl: 'https://client.example.com', webhookPath: 'invoice-sync-b7e2c1aa' },
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ result: 'bound' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://client.example.com/webhook/invoice-sync-b7e2c1aa',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Woops-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
        }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('signs with the per-binding secret when provided (same scheme)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(mockConfig() as never);
    await service.execute({
      workflow: 'wf',
      input: {},
      binding: {
        baseUrl: 'https://client.example.com',
        webhookPath: 'wf',
        secret: 'per-binding-secret-123456',
      },
      timeoutMs: 1_000,
    });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Woops-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers['X-Woops-Internal-Key']).toBe('per-binding-secret-123456');
    vi.unstubAllGlobals();
  });

  it('does not require platform env config when a binding is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = { get: vi.fn().mockReturnValue(undefined) };
    const service = new N8nWorkflowExecutorService(config as never);
    await expect(
      service.execute({
        workflow: 'wf',
        input: {},
        binding: { baseUrl: 'https://client.example.com', webhookPath: 'wf' },
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ ok: true });
    vi.unstubAllGlobals();
  });
});
