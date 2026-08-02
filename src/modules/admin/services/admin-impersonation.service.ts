import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminAuditRepository } from '../repositories/admin-audit.repository';
import { AdminUsersRepository } from '../repositories/admin-users.repository';

@Injectable()
export class AdminImpersonationService {
  private readonly logger = new Logger(AdminImpersonationService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly auditRepo: AdminAuditRepository,
    private readonly userRepo: AdminUsersRepository,
  ) {}

  async impersonate(adminId: string, targetUserId: string, reason: string) {
    const targetUser = await this.userRepo.findById(targetUserId);
    if (!targetUser) throw new NotFoundException('Target user not found');

    if (!targetUser.isActive) {
      throw new UnauthorizedException('Cannot impersonate a suspended user');
    }

    const log = await this.auditRepo.createImpersonationLog({
      adminId,
      targetUserId,
      reason,
    });

    const impersonationToken = await this.jwtService.signAsync({
      sub: targetUserId,
      email: targetUser.email,
      role: targetUser.role,
      impersonatedBy: adminId,
      impersonationLogId: log.id,
      isImpersonation: true,
    });

    this.logger.warn(`Admin ${adminId} impersonating user ${targetUserId}`);

    return {
      accessToken: impersonationToken,
      impersonatedUser: { id: targetUser.id, email: targetUser.email, name: targetUser.name },
      impersonationLogId: log.id,
    };
  }

  async getImpersonationHistory(limit = 100, offset = 0) {
    return this.auditRepo.findImpersonationLogs(limit, offset);
  }

  async endImpersonation(logId: string) {
    return this.auditRepo.endImpersonation(logId);
  }
}
