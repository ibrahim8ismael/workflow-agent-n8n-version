import { describe, expect, it, vi } from 'vitest';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

describe('N8nWorkflowExecutorService', () => {
  it('keeps webhook configuration inside the infrastructure adapter', async () => {
    const config = { get: vi.fn().mockReturnValue('https://n8n.example.com/webhook') };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ result: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(config as never);
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
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('classifies missing configuration without attempting a request', async () => {
    const config = { get: vi.fn().mockReturnValue(undefined) };
    const service = new N8nWorkflowExecutorService(config as never);

    await expect(
      service.execute({ workflow: 'support', input: {}, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ retryable: false, message: 'N8N_WEBHOOK_URL is not configured' });
  });

  it('passes the stable idempotency key to n8n', async () => {
    const config = { get: vi.fn().mockReturnValue('https://n8n.example.com/webhook') };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('application/json') },
      json: vi.fn().mockResolvedValue({ result: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new N8nWorkflowExecutorService(config as never);
    await service.execute({
      workflow: 'support',
      input: {},
      timeoutMs: 1_000,
      idempotencyKey: 'run-1:tool-1:action-1',
    });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'run-1:tool-1:action-1' }),
      }),
    );
    vi.unstubAllGlobals();
  });
});
