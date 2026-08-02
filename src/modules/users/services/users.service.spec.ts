/* eslint-disable @typescript-eslint/no-explicit-any */

import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  phone: null,
  name: 'Test User',
  avatarUrl: null,
  emailVerifiedAt: new Date(),
  role: 'USER',
  isActive: true,
  tokenVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function createMockRepo() {
  return {
    findById: vi.fn().mockResolvedValue(mockUser),
    findByEmail: vi.fn().mockResolvedValue(mockUser),
    update: vi.fn().mockResolvedValue({ ...mockUser, name: 'Updated' }),
    deactivateUser: vi
      .fn()
      .mockResolvedValue({ ...mockUser, isActive: false, deletedAt: new Date(), tokenVersion: 1 }),
    findActiveSessions: vi.fn().mockResolvedValue([
      {
        id: 'sess-1',
        device: 'mobile',
        browser: 'Chrome',
        ip: '127.0.0.1',
        lastUsedAt: new Date(),
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ]),
    findSessionById: vi.fn().mockResolvedValue({ id: 'sess-1', userId: 'user-1' }),
    revokeSession: vi.fn().mockResolvedValue({}),
    revokeAllSessions: vi.fn().mockResolvedValue({ count: 1 }),
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let repo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockRepo();
    service = new UsersService(repo as any);
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      const result = await service.getProfile('user-1');

      expect(result.id).toBe('user-1');
      expect(result.email).toBe('test@test.com');
      expect(result.name).toBe('Test User');
      expect(repo.findById).toHaveBeenCalledWith('user-1');
    });

    it('should throw when user not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const result = await service.updateProfile('user-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
      expect(repo.update).toHaveBeenCalledWith('user-1', { name: 'Updated' });
    });

    it('should throw when user not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.updateProfile('nonexistent', { name: 'Nope' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update only provided fields', async () => {
      await service.updateProfile('user-1', { name: 'New Name' });
      expect(repo.update).toHaveBeenCalledWith('user-1', { name: 'New Name' });

      await service.updateProfile('user-1', { avatarUrl: 'https://example.com/avatar.png' });
      expect(repo.update).toHaveBeenCalledWith('user-1', {
        avatarUrl: 'https://example.com/avatar.png',
      });
    });
  });

  describe('deactivateAccount', () => {
    it('should deactivate user and revoke sessions', async () => {
      await service.deactivateAccount('user-1');

      expect(repo.deactivateUser).toHaveBeenCalledWith('user-1');
      expect(repo.revokeAllSessions).toHaveBeenCalledWith('user-1');
    });

    it('should throw when user not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.deactivateAccount('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw when already deactivated', async () => {
      repo.findById.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(service.deactivateAccount('user-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('getUserById', () => {
    it('should return user by id', async () => {
      const result = await service.getUserById('user-1');

      expect(result.id).toBe('user-1');
      expect(result.email).toBe('test@test.com');
    });

    it('should throw when user not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getUserById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUserSessions', () => {
    it('should return active sessions', async () => {
      const sessions = await service.getUserSessions('user-1');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe('sess-1');
      expect(repo.findActiveSessions).toHaveBeenCalledWith('user-1');
    });

    it('should throw when user not found', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getUserSessions('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeSession', () => {
    it('should revoke session by id', async () => {
      await service.revokeSession('user-1', 'sess-1');

      expect(repo.revokeSession).toHaveBeenCalledWith('sess-1');
    });

    it('should throw when session not found', async () => {
      repo.findSessionById.mockResolvedValue(null);

      await expect(service.revokeSession('user-1', 'unknown')).rejects.toThrow(NotFoundException);
    });

    it('should throw when session belongs to another user', async () => {
      repo.findSessionById.mockResolvedValue({ id: 'sess-2', userId: 'user-2' });

      await expect(service.revokeSession('user-1', 'sess-2')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
