import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsRepository } from '../repositories/conversations.repository';
import { ConversationsService } from './conversations.service';

describe('ConversationsService', () => {
  let service: ConversationsService;

  const conversation = (overrides: Record<string, unknown> = {}) => ({
    id: 'conv-1',
    title: 'Support chat',
    agentId: 'agent-1',
    status: 'ACTIVE',
    ...overrides,
  });

  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as ConversationsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.create).mockResolvedValue(conversation() as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(conversation() as never);
    vi.mocked(mockRepo.findMany).mockResolvedValue([conversation()] as never);
    vi.mocked(mockRepo.addMessage).mockResolvedValue({
      id: 'msg-1',
      role: 'user',
      content: 'Hi',
    } as never);
    vi.mocked(mockRepo.getMessages).mockResolvedValue([
      { id: 'msg-1', role: 'user', content: 'Hi' },
    ] as never);
    vi.mocked(mockRepo.update).mockResolvedValue(conversation() as never);
    vi.mocked(mockRepo.softDelete).mockResolvedValue(conversation() as never);
    service = new ConversationsService(mockRepo);
  });

  describe('create', () => {
    it('should create an ACTIVE conversation with the agent connected', async () => {
      await service.create({
        title: 'Chat',
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Chat',
          agent: { connect: { id: 'agent-1' } },
          user: { connect: { id: 'user-1' } },
          organization: { connect: { id: 'org-1' } },
          status: 'ACTIVE',
        }),
      );
    });
  });

  describe('findById / findMany', () => {
    it('should return the conversation when found', async () => {
      const result = await service.findById('conv-1');

      expect(result.id).toBe('conv-1');
    });

    it('should throw when the conversation is missing', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('should build the where clause from filters', async () => {
      await service.findMany({
        agentId: 'agent-1',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        skip: 1,
        take: 5,
      });

      expect(mockRepo.findMany).toHaveBeenCalledWith({
        where: { agentId: 'agent-1', userId: 'user-1', organizationId: 'org-1', status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        skip: 1,
        take: 5,
      });
    });
  });

  describe('addMessage / getMessages', () => {
    it('should add a message to an existing conversation', async () => {
      await service.addMessage('conv-1', { role: 'user', content: 'Hi' });

      expect(mockRepo.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation: { connect: { id: 'conv-1' } },
          role: 'user',
          content: 'Hi',
        }),
      );
    });

    it('should throw when adding to a missing conversation', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.addMessage('missing', { role: 'user', content: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should list messages of an existing conversation', async () => {
      const result = await service.getMessages('conv-1', { take: 10 });

      expect(mockRepo.getMessages).toHaveBeenCalledWith('conv-1', { take: 10 });
      expect(result).toHaveLength(1);
    });
  });

  describe('resolve / archive / softDelete', () => {
    it('should resolve an existing conversation', async () => {
      await service.resolve('conv-1');

      expect(mockRepo.update).toHaveBeenCalledWith('conv-1', { status: 'RESOLVED' });
    });

    it('should archive an existing conversation', async () => {
      await service.archive('conv-1');

      expect(mockRepo.update).toHaveBeenCalledWith('conv-1', { status: 'ARCHIVED' });
    });

    it('should soft delete an existing conversation', async () => {
      await service.softDelete('conv-1');

      expect(mockRepo.softDelete).toHaveBeenCalledWith('conv-1');
    });
  });
});
