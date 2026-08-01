import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { AdminAuditRepository } from '../repositories/admin-audit.repository';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminAuditController {
  constructor(private readonly auditRepo: AdminAuditRepository) {}

  @Get()
  async getAuditLogs(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.auditRepo.findAuditLogs(Number(limit) || 100, Number(offset) || 0, {
      action,
      userId,
      entityType,
    });
  }

  @Get('impersonations')
  async getImpersonations(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.auditRepo.findImpersonationLogs(Number(limit) || 100, Number(offset) || 0);
  }
}
