import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsRepository } from '../repositories/skills.repository';
import { SkillsService } from './skills.service';

describe('SkillsService', () => {
  let service: SkillsService;

  const skill = (overrides: Record<string, unknown> = {}) => ({
    id: 'skill-1',
    name: 'Search Knowledge',
    slug: 'search-knowledge',
    status: 'DRAFT',
    ...overrides,
  });

  const mockRepo = {
    findBySlug: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as SkillsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findBySlug).mockResolvedValue(null);
    vi.mocked(mockRepo.findById).mockResolvedValue(skill() as never);
    vi.mocked(mockRepo.findMany).mockResolvedValue([skill()] as never);
    vi.mocked(mockRepo.create).mockResolvedValue(skill() as never);
    vi.mocked(mockRepo.update).mockResolvedValue(skill() as never);
    vi.mocked(mockRepo.softDelete).mockResolvedValue(skill() as never);
    service = new SkillsService(mockRepo);
  });

  describe('create', () => {
    it('should create a skill when the slug is free', async () => {
      await service.create({ name: 'Search', slug: 'search', executionMode: 'AI_ONLY' });

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'DRAFT' }));
    });

    it('should throw when the slug already exists', async () => {
      vi.mocked(mockRepo.findBySlug).mockResolvedValue(skill() as never);

      await expect(
        service.create({ name: 'Search', slug: 'search', executionMode: 'AI_ONLY' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById / findBySlug / findMany', () => {
    it('should return a skill when found', async () => {
      const result = await service.findById('skill-1');

      expect(result.id).toBe('skill-1');
    });

    it('should throw when the skill does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('should delegate findBySlug', async () => {
      const result = await service.findBySlug('search-knowledge');

      expect(mockRepo.findBySlug).toHaveBeenCalledWith('search-knowledge');
      expect(result).toBeNull();
    });

    it('should delegate findMany with params', async () => {
      await service.findMany({ skip: 1, take: 5 });

      expect(mockRepo.findMany).toHaveBeenCalledWith({ skip: 1, take: 5 });
    });
  });

  describe('update / softDelete / publish / archive', () => {
    it('should update an existing skill', async () => {
      await service.update('skill-1', { name: 'New' });

      expect(mockRepo.update).toHaveBeenCalledWith('skill-1', { name: 'New' });
    });

    it('should throw on update when the skill does not exist', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.update('missing', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('should soft delete an existing skill', async () => {
      await service.softDelete('skill-1');

      expect(mockRepo.softDelete).toHaveBeenCalledWith('skill-1');
    });

    it('should publish a skill', async () => {
      await service.publish('skill-1');

      expect(mockRepo.update).toHaveBeenCalledWith('skill-1', { status: 'PUBLISHED' });
    });

    it('should archive a skill', async () => {
      await service.archive('skill-1');

      expect(mockRepo.update).toHaveBeenCalledWith('skill-1', { status: 'ARCHIVED' });
    });
  });
});
