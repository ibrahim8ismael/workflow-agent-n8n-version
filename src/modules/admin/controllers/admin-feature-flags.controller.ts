import { Controller, Get, Patch, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AdminFeatureFlagsService } from '../services/admin-feature-flags.service';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

@Controller('admin/feature-flags')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminFeatureFlagsController {
  constructor(private readonly flagService: AdminFeatureFlagsService) {}

  @Get()
  async findAll() {
    return this.flagService.findAll();
  }

  @Get(':key')
  async findByKey(@Param('key') key: string) {
    return this.flagService.findByKey(key);
  }

  @Post()
  async create(
    @Body() dto: { key: string; name: string; description?: string; enabled?: boolean },
  ) {
    return this.flagService.create(dto);
  }

  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body() dto: { name?: string; description?: string; enabled?: boolean },
  ) {
    return this.flagService.update(key, dto);
  }

  @Post(':key/overrides')
  async setOverride(
    @Param('key') key: string,
    @Body() dto: { entityType: string; entityId: string; enabled: boolean; reason?: string },
  ) {
    return this.flagService.setOverride(key, dto.entityType, dto.entityId, dto.enabled, dto.reason);
  }

  @Delete(':key/overrides')
  async removeOverride(
    @Param('key') key: string,
    @Body() dto: { entityType: string; entityId: string },
  ) {
    return this.flagService.removeOverride(key, dto.entityType, dto.entityId);
  }
}
