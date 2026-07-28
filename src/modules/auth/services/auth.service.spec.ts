import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, argon2id } from 'argon2';
import { AuthService } from './auth.service';
import { AuthRepository } from '../repositories/auth.repository';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import { NotificationService } from '../../../infrastructure/email/notification.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockJwtService = {
    signAsync: vi.fn().mockResolvedValue('mock-access-token'),
  } as unknown as JwtService;
  const mockRedis = {
    checkRateLimit: vi.fn().mockResolvedValue(true),
    storeOtp: vi.fn().mockResolvedValue(undefined),
    getOtpData: vi.fn(),
    incrementOtpAttempts: vi.fn().mockResolvedValue(1),
    deleteOtp: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisService;
  const mockNotification = {
    sendOtp: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;

  const mockRepo = {
    upsertUser: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      role: 'USER',
      tokenVersion: 0,
    }),
    createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
    findSessionByRefreshToken: vi.fn(),
    updateSessionRefreshToken: vi.fn().mockResolvedValue({}),
    revokeSession: vi.fn().mockResolvedValue({}),
    revokeAllUserSessions: vi.fn().mockResolvedValue({ count: 1 }),
    incrementTokenVersion: vi.fn().mockResolvedValue({ tokenVersion: 1 }),
    findUserById: vi
      .fn()
      .mockResolvedValue({ id: 'user-1', email: 'test@test.com', role: 'USER', tokenVersion: 0 }),
    findOrganizationMembership: vi.fn(),
  } as unknown as AuthRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService(mockJwtService, mockRedis, mockRepo, mockNotification);
  });

  describe('requestOtp', () => {
    it('should generate and send OTP', async () => {
      await service.requestOtp('test@test.com', '127.0.0.1');

      expect(mockRedis.checkRateLimit).toHaveBeenCalledTimes(2);
      expect(mockRedis.storeOtp).toHaveBeenCalled();
    });

    it('should throw when email rate limit exceeded', async () => {
      vi.mocked(mockRedis.checkRateLimit).mockResolvedValueOnce(false);

      await expect(service.requestOtp('test@test.com', '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw when IP rate limit exceeded', async () => {
      vi.mocked(mockRedis.checkRateLimit).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(service.requestOtp('test@test.com', '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('verifyOtp', () => {
    it('should throw when no OTP stored', async () => {
      vi.mocked(mockRedis.getOtpData).mockResolvedValue(null);

      await expect(
        service.verifyOtp('test@test.com', '123456', '127.0.0.1', 'Chrome'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw when max attempts exceeded', async () => {
      vi.mocked(mockRedis.getOtpData).mockResolvedValue({ hashedOtp: '', attempts: 5 });

      await expect(
        service.verifyOtp('test@test.com', '123456', '127.0.0.1', 'Chrome'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw on invalid OTP', async () => {
      const validHash = await hash('999999', { type: argon2id });
      vi.mocked(mockRedis.getOtpData).mockResolvedValue({ hashedOtp: validHash, attempts: 0 });

      await expect(
        service.verifyOtp('test@test.com', '000000', '127.0.0.1', 'Chrome'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyOtp (happy path)', () => {
    it('should return tokens and user on success', async () => {
      const hashedOtp = await hash('654321', { type: argon2id });
      vi.mocked(mockRedis.getOtpData).mockResolvedValue({ hashedOtp, attempts: 0 });

      const result = await service.verifyOtp('test@test.com', '654321', '127.0.0.1', 'Chrome');

      expect(result).toMatchObject({
        accessToken: 'mock-access-token',
        sessionId: expect.any(String),
        user: { email: 'test@test.com' },
      });
      expect(result.refreshToken).toBeDefined();
      expect(mockJwtService.signAsync).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const mockSession = {
      id: 'session-1',
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 'user-1', email: 'test@test.com', role: 'USER', tokenVersion: 0, isActive: true },
    };

    it('should rotate tokens on valid refresh', async () => {
      vi.mocked(mockRepo.findSessionByRefreshToken).mockResolvedValue(mockSession as never);

      const result = await service.refresh('valid-refresh-token', '127.0.0.1');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe('valid-refresh-token');
      expect(mockRepo.updateSessionRefreshToken).toHaveBeenCalled();
    });

    it('should throw on expired session', async () => {
      const expiredSession = { ...mockSession, expiresAt: new Date(Date.now() - 1000) };
      vi.mocked(mockRepo.findSessionByRefreshToken).mockResolvedValue(expiredSession as never);

      await expect(service.refresh('expired-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockRepo.revokeSession).toHaveBeenCalledWith(expiredSession.id);
    });

    it('should throw when session not found', async () => {
      vi.mocked(mockRepo.findSessionByRefreshToken).mockResolvedValue(null);

      await expect(service.refresh('invalid-token', '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke session by refresh token', async () => {
      const mockSession = { id: 'session-1', userId: 'user-1' };
      vi.mocked(mockRepo.findSessionByRefreshToken).mockResolvedValue(mockSession as never);

      await service.logout('some-refresh-token');

      expect(mockRepo.revokeSession).toHaveBeenCalledWith('session-1');
    });

    it('should revoke session by sessionId', async () => {
      await service.logout(undefined, 'session-1');

      expect(mockRepo.revokeSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('logoutAll', () => {
    it('should increment token version and revoke all sessions', async () => {
      await service.logoutAll('user-1');

      expect(mockRepo.incrementTokenVersion).toHaveBeenCalledWith('user-1');
      expect(mockRepo.revokeAllUserSessions).toHaveBeenCalledWith('user-1');
    });
  });

  describe('switchOrganization', () => {
    it('should issue new access token for valid membership', async () => {
      vi.mocked(mockRepo.findOrganizationMembership).mockResolvedValue({ role: 'ADMIN' } as never);

      const result = await service.switchOrganization('user-1', 'session-1', 'org-1');

      expect(result.accessToken).toBe('mock-access-token');
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', activeContext: 'organization' }),
      );
    });

    it('should throw when user is not a member', async () => {
      vi.mocked(mockRepo.findOrganizationMembership).mockResolvedValue(null);

      await expect(service.switchOrganization('user-1', 'session-1', 'org-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
