import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class UsersRepository {
  constructor(protected readonly db: DatabaseService) {}

  async findById(id: string) {
    return this.db.user.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }

  async update(id: string, data: { name?: string; avatarUrl?: string }) {
    return this.db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }

  async deactivateUser(userId: string) {
    return this.db.user.update({
      where: { id: userId },
      data: { isActive: false, deletedAt: new Date(), tokenVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        role: true,
        isActive: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }

  async findActiveSessions(userId: string) {
    return this.db.session.findMany({
      where: { userId, deletedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        device: true,
        browser: true,
        ip: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async findSessionById(sessionId: string) {
    return this.db.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    });
  }

  async revokeSession(sessionId: string) {
    return this.db.session.update({
      where: { id: sessionId },
      data: { deletedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string) {
    return this.db.session.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
