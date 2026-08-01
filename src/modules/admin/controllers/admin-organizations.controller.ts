import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { type SuspensionDto, suspensionSchema } from '../dto/admin-suspension.dto';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { AdminOrganizationsService } from '../services/admin-organizations.service';

@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminOrganizationsController {
  constructor(private readonly orgService: AdminOrganizationsService) {}

  @Get()
  async findAll(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.orgService.findAll(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('stats')
  async getStats() {
    return this.orgService.getStats();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.orgService.findById(id);
  }

  @Post(':id/suspend')
  async suspend(@Param('id') id: string, @Body() dto: SuspensionDto) {
    suspensionSchema.parse(dto);
    return this.orgService.suspend(id);
  }
}
