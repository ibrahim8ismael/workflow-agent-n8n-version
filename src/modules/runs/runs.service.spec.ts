import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsRepository } from './runs.repository';
import { RunsService } from './runs.service';

describe('RunsService', () => {
  let service: RunsService;

  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    agentId: 'agent-1',
    status: 'CREATED',
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
    it('should update status for a valid transition', async () => {
      const result = await service.transitionStatus('run-1', 'PREPARING');

      expect(mockRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'PREPARING' }),
      );
      expect(result.status).toBe('PREPARING');
    });

    it('should set completedAt when transitioning to COMPLETED', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ status: 'PERSISTING' }) as never);

      await service.transitionStatus('run-1', 'COMPLETED');

      const updateCall = vi.mocked(mockRepo.update).mock.calls[0][1] as { completedAt?: Date };
      expect(updateCall.completedAt).toBeInstanceOf(Date);
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
    it('should mark the run as COMPLETED with result and completedAt', async () => {
      await service.complete('run-1', 'final answer');

      expect(mockRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'COMPLETED', result: 'final answer' }),
      );
    });
  });

  describe('fail', () => {
    it('should mark the run as FAILED with error', async () => {
      await service.fail('run-1', 'boom');

      expect(mockRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'FAILED', error: 'boom' }),
      );
    });
  });

  describe('cancel', () => {
    it('should mark the run as CANCELLED', async () => {
      await service.cancel('run-1');

      expect(mockRepo.update).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'CANCELLED' }),
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
