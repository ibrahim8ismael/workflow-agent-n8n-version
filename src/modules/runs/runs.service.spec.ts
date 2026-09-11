import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsRepository } from './runs.repository';
import { RunsService } from './runs.service';

describe('RunsService', () => {
  let service: RunsService;

  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    agentId: 'agent-1',
    status: 'CREATED',
    version: 1,
    result: null,
    error: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByAgent: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateVersioned: vi.fn(),
    createTransition: vi.fn().mockResolvedValue({ id: 'trans-1' }),
  } as unknown as RunsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.create).mockResolvedValue(run() as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(run() as never);
    vi.mocked(mockRepo.findByAgent).mockResolvedValue([run()] as never);
    vi.mocked(mockRepo.findMany).mockResolvedValue([] as never);
    vi.mocked(mockRepo.update).mockImplementation((_id, data) =>
      Promise.resolve(run(data as never) as never),
    );
    vi.mocked(mockRepo.updateVersioned).mockImplementation((_id, _version, data) =>
      Promise.resolve(run(data as never) as never),
    );
    service = new RunsService(mockRepo);
  });

  describe('create', () => {
    it('should create a run with agent and status CREATED', async () => {
      await service.create({ agentId: 'agent-1' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: { connect: { id: 'agent-1' } },
          status: 'CREATED',
        }),
      );
    });

    it('should connect a conversation when provided', async () => {
      await service.create({ agentId: 'agent-1', conversationId: 'conv-1' });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation: { connect: { id: 'conv-1' } },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return the run when found', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ id: 'run-1' }) as never);

      const result = await service.findById('run-1');

      expect(result.id).toBe('run-1');
      expect(mockRepo.findById).toHaveBeenCalledWith('run-1');
    });

    it('should throw NotFoundException when run does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByAgent', () => {
    it('should delegate to the repository with options', async () => {
      await service.findByAgent('agent-1', { limit: 5, status: 'COMPLETED' });

      expect(mockRepo.findByAgent).toHaveBeenCalledWith('agent-1', {
        limit: 5,
        status: 'COMPLETED',
      });
    });
  });

  describe('findLatestWaitingInConversation', () => {
    it('returns the newest WAITING run excluding the current one', async () => {
      vi.mocked(mockRepo.findMany).mockResolvedValue([
        run({ id: 'new-waiting', status: 'WAITING' }),
        run({ id: 'old-waiting', status: 'WAITING' }),
      ] as never);

      const result = await service.findLatestWaitingInConversation('conv-1', 'new-waiting');

      expect(mockRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ conversationId: 'conv-1' }),
        }),
      );
      expect(result?.id).toBe('old-waiting');
    });

    it('returns null when nothing is waiting', async () => {
      vi.mocked(mockRepo.findMany).mockResolvedValue([] as never);

      await expect(service.findLatestWaitingInConversation('conv-1')).resolves.toBeNull();
    });
  });

  describe('transitionStatus', () => {
    it('updates status through the version-guarded claim', async () => {
      const result = await service.transitionStatus('run-1', 'PREPARING');

      expect(mockRepo.updateVersioned).toHaveBeenCalledWith(
        'run-1',
        1,
        expect.objectContaining({ status: 'PREPARING' }),
      );
      expect(result.status).toBe('PREPARING');
    });

    it('sets completedAt when transitioning to COMPLETED', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ status: 'PERSISTING' }) as never);

      await service.transitionStatus('run-1', 'COMPLETED');

      const updateCall = vi.mocked(mockRepo.updateVersioned).mock.calls[0][2] as {
        completedAt?: Date;
      };
      expect(updateCall.completedAt).toBeInstanceOf(Date);
    });

    it('throws ConflictException when a concurrent caller already claimed the row', async () => {
      vi.mocked(mockRepo.updateVersioned).mockResolvedValue(null);

      await expect(service.transitionStatus('run-1', 'PREPARING')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw for an invalid transition', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ status: 'CREATED' }) as never);

      await expect(service.transitionStatus('run-1', 'EXECUTING')).rejects.toThrow(
        'Invalid state transition: CREATED → EXECUTING',
      );
    });

    it('should throw when run does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.transitionStatus('missing', 'PREPARING')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('complete', () => {
    it('marks the run COMPLETED with result and completedAt via the CAS claim', async () => {
      await service.complete('run-1', 'final answer');

      expect(mockRepo.updateVersioned).toHaveBeenCalledWith(
        'run-1',
        1,
        expect.objectContaining({ status: 'COMPLETED', result: 'final answer' }),
      );
      expect(mockRepo.createTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          fromStatus: 'CREATED',
          toStatus: 'COMPLETED',
          reason: 'run completed',
        }),
      );
    });

    it('should reject completing an already-terminal run', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ status: 'COMPLETED' }) as never);

      await expect(service.complete('run-1', 'again')).rejects.toThrow(
        'COMPLETED is terminal and cannot move to COMPLETED',
      );
    });
  });

  describe('fail', () => {
    it('marks the run FAILED with error via the CAS claim', async () => {
      await service.fail('run-1', 'boom');

      expect(mockRepo.updateVersioned).toHaveBeenCalledWith(
        'run-1',
        1,
        expect.objectContaining({ status: 'FAILED', error: 'boom' }),
      );
      expect(mockRepo.createTransition).toHaveBeenCalledWith(
        expect.objectContaining({ fromStatus: 'CREATED', toStatus: 'FAILED' }),
      );
    });

    it('should reject failing a CANCELLED run', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ status: 'CANCELLED' }) as never);

      await expect(service.fail('run-1', 'boom')).rejects.toThrow(
        'CANCELLED is terminal and cannot move to FAILED',
      );
    });
  });

  describe('cancel', () => {
    it('marks the run CANCELLED via the CAS claim', async () => {
      await service.cancel('run-1');

      expect(mockRepo.updateVersioned).toHaveBeenCalledWith(
        'run-1',
        1,
        expect.objectContaining({ status: 'CANCELLED' }),
      );
    });

    it('should reject cancelling a FAILED run', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ status: 'FAILED' }) as never);

      await expect(service.cancel('run-1')).rejects.toThrow(
        'FAILED is terminal and cannot move to CANCELLED',
      );
    });
  });

  describe('updateUsage', () => {
    it('should persist token usage', async () => {
      await service.updateUsage('run-1', {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
      );
    });
  });

  describe('recordModelUsage', () => {
    it('accumulates usage and estimated cost across graph model calls', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          estimatedCost: 0.25,
        }) as never,
      );

      await service.recordModelUsage(
        'run-1',
        {
          promptTokens: 3,
          completionTokens: 2,
          totalTokens: 5,
        },
        0.1,
      );

      expect(mockRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          promptTokens: 13,
          completionTokens: 7,
          totalTokens: 20,
          estimatedCost: 0.35,
        }),
      );
    });
  });
});
