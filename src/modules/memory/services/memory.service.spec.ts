import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../repositories/memory.repository';
import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  let service: MemoryService;

  const memory = (overrides: Record<string, unknown> = {}) => ({
    id: 'memory-1',
    agentId: 'agent-1',
    key: 'last-topic',
    type: 'CONVERSATION',
    content: 'Q2 revenue',
    ...overrides,
  });

  const mockRepo = {
    findByAgentAndKey: vi.fn(),
    findById: vi.fn(),
    findByAgent: vi.fn(),
    searchByAgent: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as MemoryRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findByAgentAndKey).mockResolvedValue(null);
    vi.mocked(mockRepo.findById).mockResolvedValue(memory() as never);
    vi.mocked(mockRepo.findByAgent).mockResolvedValue([memory()] as never);
    vi.mocked(mockRepo.searchByAgent).mockResolvedValue([memory()] as never);
    vi.mocked(mockRepo.create).mockResolvedValue(memory() as never);
    vi.mocked(mockRepo.update).mockResolvedValue(memory() as never);
    vi.mocked(mockRepo.softDelete).mockResolvedValue(memory() as never);
    service = new MemoryService(mockRepo);
  });

  describe('create', () => {
    it('should create a memory with agent, user and organization connections', async () => {
      await service.create({
        agentId: 'agent-1',
        key: 'last-topic',
        type: 'CONVERSATION',
        content: 'Q2 revenue',
        userId: 'user-1',
        organizationId: 'org-1',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: { connect: { id: 'agent-1' } },
          user: { connect: { id: 'user-1' } },
          organization: { connect: { id: 'org-1' } },
          key: 'last-topic',
        }),
      );
    });

    it('should convert expiresAt to a Date', async () => {
      await service.create({
        agentId: 'agent-1',
        key: 'tmp',
        type: 'AGENT',
        content: 'x',
        expiresAt: '2026-12-31T00:00:00.000Z',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: expect.any(Date) }),
      );
    });

    it('should throw when the key already exists for the agent', async () => {
      vi.mocked(mockRepo.findByAgentAndKey).mockResolvedValue(memory() as never);

      await expect(
        service.create({
          agentId: 'agent-1',
          key: 'last-topic',
          type: 'CONVERSATION',
          content: 'dup',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById / findByAgent / searchByAgent', () => {
    it('should return a memory when found', async () => {
      const result = await service.findById('memory-1');

      expect(result.id).toBe('memory-1');
    });

    it('should throw when the memory is missing', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('should delegate findByAgent with options', async () => {
      await service.findByAgent('agent-1', { type: 'AGENT', take: 5 });

      expect(mockRepo.findByAgent).toHaveBeenCalledWith('agent-1', {
        type: 'AGENT',
        take: 5,
      });
    });

    it('should delegate searchByAgent with options', async () => {
      await service.searchByAgent('agent-1', 'revenue', { limit: 10 });

      expect(mockRepo.searchByAgent).toHaveBeenCalledWith('agent-1', 'revenue', { limit: 10 });
    });
  });

  describe('update / upsert / softDelete', () => {
    it('should update an existing memory', async () => {
      await service.update('memory-1', { content: 'new content' });

      expect(mockRepo.update).toHaveBeenCalledWith(
        'memory-1',
        expect.objectContaining({ content: 'new content' }),
      );
    });

    it('should throw on update when the memory is missing', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.update('missing', { content: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('should update an existing memory on upsert', async () => {
      vi.mocked(mockRepo.findByAgentAndKey).mockResolvedValue(memory() as never);

      await service.upsert('agent-1', 'last-topic', 'CONVERSATION', 'new content');

      expect(mockRepo.update).toHaveBeenCalledWith(
        'memory-1',
        expect.objectContaining({ content: 'new content' }),
      );
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('should create a new memory when none exists on upsert', async () => {
      await service.upsert('agent-1', 'new-key', 'AGENT', 'content');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: { connect: { id: 'agent-1' } },
          key: 'new-key',
          type: 'AGENT',
          content: 'content',
        }),
      );
    });

    it('should soft delete an existing memory', async () => {
      await service.softDelete('memory-1');

      expect(mockRepo.softDelete).toHaveBeenCalledWith('memory-1');
    });
  });
});
