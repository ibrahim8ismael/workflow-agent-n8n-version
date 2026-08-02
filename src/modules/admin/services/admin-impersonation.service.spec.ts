import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditRepository } from '../repositories/admin-audit.repository';
import { AdminUsersRepository } from '../repositories/admin-users.repository';
import { AdminImpersonationService } from './admin-impersonation.service';

describe('AdminImpersonationService', () => {
  let service: AdminImpersonationService;

  const targetUser = {
    id: 'user-2',
    email: 'target@test.com',
    name: 'Target',
    role: 'USER',
    isActive: true,
  };

  const mockJwtService = {
    signAsync: vi.fn().mockResolvedValue('impersonation-token' as never),
  } as unknown as JwtService;

  const mockAuditRepo = {
    createImpersonationLog: vi.fn(),
    findImpersonationLogs: vi.fn(),
    endImpersonation: vi.fn(),
  } as unknown as AdminAuditRepository;

  const mockUserRepo = {
    findById: vi.fn(),
  } as unknown as AdminUsersRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockUserRepo.findById).mockResolvedValue(targetUser as never);
    vi.mocked(mockAuditRepo.createImpersonationLog).mockResolvedValue({ id: 'log-1' } as never);
    vi.mocked(mockAuditRepo.findImpersonationLogs).mockResolvedValue([] as never);
    vi.mocked(mockAuditRepo.endImpersonation).mockResolvedValue({
      id: 'log-1',
      endedAt: new Date(),
    } as never);
    vi.mocked(mockJwtService.signAsync).mockResolvedValue('impersonation-token' as never);
    service = new AdminImpersonationService(mockJwtService, mockAuditRepo, mockUserRepo);
  });

  describe('impersonate', () => {
    it('should throw when the target user is missing', async () => {
      vi.mocked(mockUserRepo.findById).mockResolvedValue(null);

      await expect(service.impersonate('admin-1', 'missing', 'support')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw when the target user is suspended', async () => {
      vi.mocked(mockUserRepo.findById).mockResolvedValue({
        ...targetUser,
        isActive: false,
      } as never);

      await expect(service.impersonate('admin-1', 'user-2', 'support')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should audit, sign a token and return the impersonation payload', async () => {
      const result = await service.impersonate('admin-1', 'user-2', 'support ticket #42');

      expect(mockAuditRepo.createImpersonationLog).toHaveBeenCalledWith({
        adminId: 'admin-1',
        targetUserId: 'user-2',
        reason: 'support ticket #42',
      });
      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-2',
        email: 'target@test.com',
        role: 'USER',
        impersonatedBy: 'admin-1',
        impersonationLogId: 'log-1',
        isImpersonation: true,
      });
      expect(result).toEqual({
        accessToken: 'impersonation-token',
        impersonatedUser: {
          id: 'user-2',
          email: 'target@test.com',
          name: 'Target',
        },
        impersonationLogId: 'log-1',
      });
    });
  });

  describe('getImpersonationHistory / endImpersonation', () => {
    it('should list logs with pagination defaults', async () => {
      await service.getImpersonationHistory();

      expect(mockAuditRepo.findImpersonationLogs).toHaveBeenCalledWith(100, 0);
    });

    it('should list logs with explicit pagination', async () => {
      await service.getImpersonationHistory(50, 10);

      expect(mockAuditRepo.findImpersonationLogs).toHaveBeenCalledWith(50, 10);
    });

    it('should end an impersonation session', async () => {
      const result = await service.endImpersonation('log-1');

      expect(mockAuditRepo.endImpersonation).toHaveBeenCalledWith('log-1');
      expect(result.endedAt).toBeInstanceOf(Date);
    });
  });
});
