import { createHash } from 'node:crypto';
import type { RuntimeIdempotencyKey } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { IdempotencyRequest } from '../interfaces/idempotency.interface';
import { IdempotencyRepository } from '../repositories/idempotency.repository';
import {
  IdempotencyInProgressError,
  IdempotencyUnknownStatusError,
  JaafarIdempotencyService,
} from './jaafar-idempotency.service';

const request: IdempotencyRequest = {
  runId: 'run-1',
  toolId: 'tool-1',
  logicalAction: 'send',
  input: { recipient: 'person@example.com' },
};

const record = (overrides: Partial<RuntimeIdempotencyKey> = {}): RuntimeIdempotencyKey => ({
  id: 'record-1',
  key: 'run-1:tool-1:send',
  runId: 'run-1',
  toolId: 'tool-1',
  logicalAction: 'send',
  inputHash: 'hash',
  status: 'STARTED',
  result: null,
  error: null,
  startedAt: new Date(),
  completedAt: null,
  updatedAt: new Date(),
  expiresAt: null,
  ...overrides,
});

describe('JaafarIdempotencyService', () => {
  it('creates a deterministic record for a new action', async () => {
    const repository = {
      createStarted: vi.fn().mockResolvedValue(record()),
      findByKey: vi.fn(),
    } as unknown as IdempotencyRepository;
    const service = new JaafarIdempotencyService(repository);

    const result = await service.begin(request);

    expect(repository.createStarted).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'run-1:tool-1:send', runId: 'run-1' }),
    );
    expect(result.status).toBe('STARTED');
  });

  it('returns a completed result when the same action is replayed', async () => {
    const createStarted = vi.fn().mockResolvedValue(record());
    const findByKey = vi.fn();
    const repository = { createStarted, findByKey } as unknown as IdempotencyRepository;
    const service = new JaafarIdempotencyService(repository);
    await service.begin(request);
    const inputHash = createStarted.mock.calls[0][0].inputHash as string;
    createStarted.mockRejectedValue(new Error('unique violation'));
    findByKey.mockResolvedValue(record({ inputHash, status: 'COMPLETED', result: { sent: true } }));

    await expect(service.begin(request)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { sent: true },
    });
  });

  it('blocks concurrent and unknown side-effect execution', async () => {
    const repository = {
      createStarted: vi.fn().mockRejectedValue(new Error('unique violation')),
      findByKey: vi.fn().mockResolvedValue(record()),
    } as unknown as IdempotencyRepository;
    const service = new JaafarIdempotencyService(repository);
    const inputHash = createHash('sha256').update(JSON.stringify(request.input)).digest('hex');
    vi.mocked(repository.findByKey).mockResolvedValueOnce(record({ inputHash: 'different' }));

    await expect(service.begin(request)).rejects.toThrow('different input');
    vi.mocked(repository.findByKey).mockResolvedValueOnce(record({ inputHash, status: 'STARTED' }));
    await expect(service.begin(request)).rejects.toThrow(IdempotencyInProgressError);
    vi.mocked(repository.findByKey).mockResolvedValue(record({ status: 'UNKNOWN', inputHash }));
    await expect(service.begin(request)).rejects.toThrow(IdempotencyUnknownStatusError);
  });

  it('persists completion, failure, and unknown outcomes', async () => {
    const repository = {
      complete: vi.fn().mockResolvedValue(record({ status: 'COMPLETED', result: { sent: true } })),
      fail: vi.fn().mockResolvedValue(record({ status: 'FAILED', error: 'timeout' })),
      markUnknown: vi.fn().mockResolvedValue(record({ status: 'UNKNOWN', error: 'network lost' })),
    } as unknown as IdempotencyRepository;
    const service = new JaafarIdempotencyService(repository);

    await expect(service.complete('run-1:tool-1:send', { sent: true })).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    await expect(service.fail('run-1:tool-1:send', 'timeout')).resolves.toMatchObject({
      status: 'FAILED',
    });
    await expect(service.markUnknown('run-1:tool-1:send', 'network lost')).resolves.toMatchObject({
      status: 'UNKNOWN',
    });
  });
});
