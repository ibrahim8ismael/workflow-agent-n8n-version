import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { hash as argon2Hash, argon2id, verify as argon2Verify } from 'argon2';
import type { RedisService } from '../../../infrastructure/cache/redis.service';
import type { NotificationService } from '../../../infrastructure/email/notification.service';
import {
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_PER_EMAIL,
  OTP_RATE_LIMIT_PER_IP,
  OTP_RATE_LIMIT_WINDOW,
} from '../constants/auth.constants';
import type { AuthRepository } from '../repositories/auth.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly repo: AuthRepository,
    private readonly notification: NotificationService,
  ) {}

  async requestOtp(email: string, ip: string): Promise<void> {
    const emailKey = `otp_req:${email}`;
    const ipKey = `otp_req_ip:${ip}`;

    const emailOk = await this.redis.checkRateLimit(
      emailKey,
      OTP_RATE_LIMIT_PER_EMAIL,
      OTP_RATE_LIMIT_WINDOW,
    );
    if (!emailOk) {
      throw new ConflictException('Too many OTP requests for this email. Try again later.');
    }

    const ipOk = await this.redis.checkRateLimit(
      ipKey,
      OTP_RATE_LIMIT_PER_IP,
      OTP_RATE_LIMIT_WINDOW,
    );
    if (!ipOk) {
      throw new ConflictException('Too many OTP requests from this IP. Try again later.');
    }

    const otp = this.generateOtp();
    const hashedOtp = await argon2Hash(otp, { type: argon2id });

    await this.redis.storeOtp(email, hashedOtp, OTP_EXPIRY_SECONDS);

    await this.notification.sendOtp(email, otp);
  }

  async verifyOtp(email: string, otp: string, ip: string, userAgent: string) {
    const otpData = await this.redis.getOtpData(email);

    if (!otpData) {
      throw new UnauthorizedException('OTP not found or expired. Request a new one.');
    }

    if (otpData.attempts >= OTP_MAX_ATTEMPTS) {
      await this.redis.deleteOtp(email);
      throw new UnauthorizedException('Too many failed attempts. Request a new OTP.');
    }

    const isValid = await argon2Verify(otpData.hashedOtp, otp);

    if (!isValid) {
      await this.redis.incrementOtpAttempts(email);
      throw new UnauthorizedException('Invalid OTP.');
    }

    await this.redis.deleteOtp(email);

    const user = await this.repo.upsertUser(email);

    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = await this.hashRefreshToken(refreshToken);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const session = await this.repo.createSession({
      userId: user.id,
      refreshTokenHash,
      device: this.parseDevice(userAgent),
      browser: this.parseBrowser(userAgent),
      ip,
      expiresAt: sessionExpiresAt,
    });

    const accessToken = await this.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      sessionId: session.id,
      activeContext: 'individual',
    });

    return {
      accessToken,
      refreshToken,
      sessionId: session.id,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async refresh(oldRefreshToken: string, _ip: string) {
    const tokenHash = await this.hashRefreshToken(oldRefreshToken);
    const session = await this.repo.findSessionByRefreshToken(tokenHash);

    if (!session) {
      const recycled = await this.findRecycledToken(tokenHash);
      if (recycled) {
        await this.repo.incrementTokenVersion(recycled.userId);
        await this.repo.revokeAllUserSessions(recycled.userId);
        throw new UnauthorizedException('Token reuse detected. All sessions revoked.');
      }
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (session.expiresAt < new Date()) {
      await this.repo.revokeSession(session.id);
      throw new UnauthorizedException('Refresh token expired.');
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException('Account is deactivated.');
    }

    const newRefreshToken = this.generateRefreshToken();
    const newRefreshTokenHash = await this.hashRefreshToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.repo.updateSessionRefreshToken(session.id, newRefreshTokenHash, newExpiresAt);

    const accessToken = await this.generateAccessToken({
      sub: session.user.id,
      email: session.user.email,
      role: session.user.role,
      tokenVersion: session.user.tokenVersion,
      sessionId: session.id,
      activeContext: 'individual',
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    if (!refreshToken && sessionId) {
      await this.repo.revokeSession(sessionId);
      return;
    }

    if (!refreshToken) return;

    const tokenHash = await this.hashRefreshToken(refreshToken);
    const session = await this.repo.findSessionByRefreshToken(tokenHash);
    if (session) {
      await this.repo.revokeSession(session.id);
    }
  }

  async logoutAll(userId: string) {
    await this.repo.incrementTokenVersion(userId);
    await this.repo.revokeAllUserSessions(userId);
  }

  async switchOrganization(userId: string, sessionId: string, organizationId: string) {
    const membership = await this.repo.findOrganizationMembership(userId, organizationId);

    if (!membership) {
      throw new UnauthorizedException('You are not a member of this organization.');
    }

    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const accessToken = await this.generateAccessToken({
      sub: userId,
      email: user.email,
      role: membership.role,
      tokenVersion: user.tokenVersion,
      sessionId,
      activeContext: 'organization',
      organizationId,
    });

    return { accessToken };
  }

  private generateOtp(): string {
    const chars = '0123456789';
    const bytes = randomBytes(OTP_LENGTH);
    let otp = '';
    for (let i = 0; i < OTP_LENGTH; i++) {
      otp += chars[bytes[i] % chars.length];
    }
    return otp;
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('hex');
  }

  private async hashRefreshToken(token: string): Promise<string> {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateAccessToken(payload: {
    sub: string;
    email: string;
    role: string;
    tokenVersion: number;
    sessionId: string;
    activeContext: string;
    organizationId?: string;
  }): Promise<string> {
    return this.jwtService.signAsync(payload);
  }

  private async findRecycledToken(_tokenHash: string): Promise<{ userId: string } | null> {
    return null;
  }

  private parseDevice(userAgent: string): string | undefined {
    if (!userAgent) return undefined;
    if (userAgent.includes('Mobile')) return 'mobile';
    if (userAgent.includes('Tablet')) return 'tablet';
    return 'desktop';
  }

  private parseBrowser(userAgent: string): string | undefined {
    if (!userAgent) return undefined;
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return undefined;
  }
}
