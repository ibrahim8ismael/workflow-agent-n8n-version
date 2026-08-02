import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditRepository } from '../repositories/admin-audit.repository';
import { AdminUsersRepository } from '../repositories/admin-users.repository';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  const user = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'user@test.com',
    name: 'Test',
    role: 'USER',
    isActive: true,
    ...overrides,
  });

  const mockRepo = {
    findAll: vi.fn(),
    findById: vi.fn(),
    suspend: vi.fn(),
    reactivate: vi.fn(),
    count: vi.fn(),
    countActive: vi.fn(),
  } as unknown as AdminUsersRepository;

  const mockAuditRepo = {
    createImpersonationLog: vi.fn(),
  } as unknown as AdminAuditRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findAll).mockResolvedValue([user()] as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(user() as never);
    vi.mocked(mockRepo.suspend).mockResolvedValue(user({ isActive: false }) as never);
    vi.mocked(mockRepo.reactivate).mockResolvedValue(user() as never);
    vi.mocked(mockRepo.count).mockResolvedValue(10 as never);
    vi.mocked(mockRepo.countActive).mockResolvedValue(8 as never);
    vi.mocked(mockAuditRepo.createImpersonationLog).mockResolvedValue({ id: 'log-1' } as never);
    service = new AdminUsersService(mockRepo, mockAuditRepo);
  });

  describe('findAll / findById', () => {
    it('should list users with pagination', async () => {
      await service.findAll(20, 0);

      expect(mockRepo.findAll).toHaveBeenCalledWith(20, 0);
    });

    it('should return the user when found', async () => {
      const result = await service.findById('user-1');

      expect(result.id).toBe('user-1');
    });

    it('should throw when the user is missing', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspend / reactivate', () => {
    it('should suspend an existing user and audit the action', async () => {
      await service.suspend('admin-1', 'user-1', 'spam');

      expect(mockRepo.suspend).toHaveBeenCalledWith('user-1');
      expect(mockAuditRepo.createImpersonationLog).toHaveBeenCalledWith({
        adminId: 'admin-1',
        targetUserId: 'user-1',
        reason: 'SUSPEND: spam',
      });
    });

    it('should throw when suspending a missing user', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(service.suspend('admin-1', 'missing', 'x')).rejects.toThrow(NotFoundException);
    });

    it('should reactivate an existing user and audit the action', async () => {
      await service.reactivate('admin-1', 'user-1', 'appeal approved');

      expect(mockRepo.reactivate).toHaveBeenCalledWith('user-1');
      expect(mockAuditRepo.createImpersonationLog).toHaveBeenCalledWith({
        adminId: 'admin-1',
        targetUserId: 'user-1',
        reason: 'REACTIVATE: appeal approved',
      });
    });
  });

  describe('getStats', () => {
    it('should compute suspended count from totals', async () => {
      const result = await service.getStats();

      expect(result).toEqual({ total: 10, active: 8, suspended: 2 });
    });
  });
});
