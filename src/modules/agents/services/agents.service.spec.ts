import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentsService } from './agents.service';

describe('AgentsService', () => {
  let service: AgentsService;

  const agent = (overrides: Record<string, unknown> = {}) => ({
    id: 'agent-1',
    name: 'Sales Copilot',
    status: 'DRAFT',
    ...overrides,
  });

  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    addSkill: vi.fn(),
    removeSkill: vi.fn(),
    getSkills: vi.fn(),
  } as unknown as AgentsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.create).mockResolvedValue(agent() as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(agent() as never);
    vi.mocked(mockRepo.findMany).mockResolvedValue([agent()] as never);
    vi.mocked(mockRepo.update).mockResolvedValue(agent() as never);
    vi.mocked(mockRepo.softDelete).mockResolvedValue(agent() as never);
    vi.mocked(mockRepo.addSkill).mockResolvedValue(undefined);
    vi.mocked(mockRepo.removeSkill).mockResolvedValue(undefined);
    vi.mocked(mockRepo.getSkills).mockResolvedValue([] as never);
    service = new AgentsService(mockRepo);
  });

  describe('create', () => {
    it('should create an agent with DRAFT status by default', async () => {
      await service.create({
        name: 'Copilot',
        description: 'Sells things',
        model: 'gpt-4o-mini',
        status: 'DRAFT',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Copilot', status: 'DRAFT' }),
      );
    });

    it('should respect an explicit status and connect an organization', async () => {
      await service.create({
        name: 'Copilot',
        status: 'PUBLISHED',
        model: 'gpt-4o-mini',
        organizationId: 'org-1',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PUBLISHED',
          organization: { connect: { id: 'org-1' } },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return the agent when found', async () => {
      const result = await service.findById('agent-1');

      expect(result.id).toBe('agent-1');
      expect(mockRepo.findById).toHaveBeenCalledWith('agent-1', undefined, undefined);
    });

    it('should pass includeSkills through', async () => {
      await service.findById('agent-1', true);

      expect(mockRepo.findById).toHaveBeenCalledWith('agent-1', true, undefined);
    });

    it('should throw when the agent does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMany', () => {
    it('should build a where clause from params', async () => {
      await service.findMany({ organizationId: 'org-1', status: 'PUBLISHED', skip: 2, take: 10 });

      expect(mockRepo.findMany).toHaveBeenCalledWith({
        where: { OR: [{ organizationId: 'org-1' }], status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        skip: 2,
        take: 10,
      });
    });

    it('should call with an empty where when no filters are given', async () => {
      await service.findMany();

      expect(mockRepo.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: undefined,
        take: undefined,
      });
    });
  });

  describe('update / softDelete / publish / archive', () => {
    it('should update an existing agent', async () => {
      await service.update('agent-1', { name: 'New Name' });

      expect(mockRepo.update).toHaveBeenCalledWith('agent-1', { name: 'New Name' });
    });

    it('should throw on update when the agent does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('should soft delete an existing agent', async () => {
      await service.softDelete('agent-1');

      expect(mockRepo.softDelete).toHaveBeenCalledWith('agent-1');
    });

    it('should publish an agent', async () => {
      await service.publish('agent-1');

      expect(mockRepo.update).toHaveBeenCalledWith('agent-1', { status: 'PUBLISHED' });
    });

    it('should archive an agent', async () => {
      await service.archive('agent-1');

      expect(mockRepo.update).toHaveBeenCalledWith('agent-1', { status: 'ARCHIVED' });
    });
  });

  describe('skills', () => {
    it('should attach a skill to an existing agent', async () => {
      await service.addSkill('agent-1', 'skill-1', { priority: 1 });

      expect(mockRepo.addSkill).toHaveBeenCalledWith('agent-1', 'skill-1', { priority: 1 });
    });

    it('should detach a skill from an existing agent', async () => {
      await service.removeSkill('agent-1', 'skill-1');

      expect(mockRepo.removeSkill).toHaveBeenCalledWith('agent-1', 'skill-1');
    });

    it('should list skills for an existing agent', async () => {
      await service.getSkills('agent-1');

      expect(mockRepo.getSkills).toHaveBeenCalledWith('agent-1');
    });
  });
});
