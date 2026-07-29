import { Controller, Get, Post, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { AdminUsersService } from '../services/admin-users.service';
import { AdminImpersonationService } from '../services/admin-impersonation.service';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { impersonationSchema, ImpersonationDto } from '../dto/admin-impersonation.dto';
import { suspensionSchema, SuspensionDto } from '../dto/admin-suspension.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminUsersController {
  constructor(
    private readonly usersService: AdminUsersService,
    private readonly impersonationService: AdminImpersonationService,
  ) {}

  @Get()
  async findAll(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.usersService.findAll(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('stats')
  async getStats() {
    return this.usersService.getStats();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post(':id/suspend')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async suspend(@Param('id') id: string, @Body() dto: SuspensionDto, @Req() req: any) {
    const data = suspensionSchema.parse(dto);
    return this.usersService.suspend(req.user.id, id, data.reason);
  }

  @Post(':id/reactivate')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async reactivate(@Param('id') id: string, @Body() dto: SuspensionDto, @Req() req: any) {
    const data = suspensionSchema.parse(dto);
    return this.usersService.reactivate(req.user.id, id, data.reason);
  }

  @Post(':id/impersonate')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async impersonate(@Param('id') id: string, @Body() dto: ImpersonationDto, @Req() req: any) {
    const data = impersonationSchema.parse(dto);
    return this.impersonationService.impersonate(req.user.id, id, data.reason);
  }
}
