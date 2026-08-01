import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminAuditRepository } from '../repositories/admin-audit.repository';
import { AdminUsersRepository } from '../repositories/admin-users.repository';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly repo: AdminUsersRepository,
    private readonly auditRepo: AdminAuditRepository,
  ) {}

  async findAll(limit?: number, offset?: number) {
    return this.repo.findAll(limit, offset);
  }

  async findById(id: string) {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async suspend(adminId: string, userId: string, reason: string) {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const result = await this.repo.suspend(userId);

    await this.auditRepo.createImpersonationLog({
      adminId,
      targetUserId: userId,
      reason: `SUSPEND: ${reason}`,
    });

    return result;
  }

  async reactivate(adminId: string, userId: string, reason: string) {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const result = await this.repo.reactivate(userId);

    await this.auditRepo.createImpersonationLog({
      adminId,
      targetUserId: userId,
      reason: `REACTIVATE: ${reason}`,
    });

    return result;
  }

  async getStats() {
    const total = await this.repo.count();
    const active = await this.repo.countActive();
    return { total, active, suspended: total - active };
  }
}
