import { describe, expect, it, vi } from 'vitest';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

describe('N8nWorkflowExecutorService', () => {
  const secret = 'super-secret-inter-service-key-123';

  const mockConfig = (overrides: Record<string, unknown> = {}) => ({
    get: vi.fn((key: string) => {
      if (key === 'N8N_WEBHOOK_URL') return 'https://n8n.example.com/webhook';
      if (key === 'WOOPS_INTER_SERVICE_SECRET') return secret;
      if (key === 'N8N_TIMEOUT_MS') return 1000;
      if (key === 'N8N_MAX_RETRIES') return 0;
      return overrides[key];
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
});
