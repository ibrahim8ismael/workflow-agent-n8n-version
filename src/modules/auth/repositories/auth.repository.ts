import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly db: DatabaseService) {}

  async findUserByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        emailVerifiedAt: true,
      },
    });
  }

  async findUserById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        emailVerifiedAt: true,
      },
    });
  }

  async upsertUser(email: string, name?: string) {
    const existing = await this.db.user.findUnique({ where: { email } });

    if (existing) {
      return this.db.user.update({
        where: { email },
        data: { emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
        select: { id: true, email: true, name: true, role: true, tokenVersion: true },
      });
    }

    return this.db.user.create({
      data: {
        email,
        name: name ?? email.split('@')[0],
        emailVerifiedAt: new Date(),
      },
      select: { id: true, email: true, name: true, role: true, tokenVersion: true },
    });
  }

  async createSession(data: {
    userId: string;
    refreshTokenHash: string;
    device?: string;
    browser?: string;
    ip?: string;
    expiresAt: Date;
  }) {
    return this.db.session.create({
      data: {
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        device: data.device,
        browser: data.browser,
        ip: data.ip,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findSessionByRefreshToken(refreshTokenHash: string) {
    return this.db.session.findFirst({
      where: { refreshTokenHash, deletedAt: null },
      include: {
        user: { select: { id: true, email: true, role: true, tokenVersion: true, isActive: true } },
      },
    });
  }

  async findSessionById(id: string) {
    return this.db.session.findUnique({
      where: { id },
      select: { id: true, userId: true, refreshTokenHash: true, expiresAt: true },
    });
  }

  async updateSessionRefreshToken(sessionId: string, newRefreshTokenHash: string, expiresAt: Date) {
    return this.db.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        lastUsedAt: new Date(),
        expiresAt,
      },
    });
  }

  async revokeSession(sessionId: string) {
    return this.db.session.update({
      where: { id: sessionId },
      data: { deletedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string) {
    return this.db.session.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async incrementTokenVersion(userId: string) {
    return this.db.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async findOrganizationMembership(userId: string, organizationId: string) {
    return this.db.organizationMember.findFirst({
      where: { userId, organizationId, deletedAt: null },
    });
  }
}
