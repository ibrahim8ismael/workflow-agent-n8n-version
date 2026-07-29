import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AdminSubscriptionsService } from '../services/admin-subscriptions.service';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminSubscriptionsController {
  constructor(private readonly subsService: AdminSubscriptionsService) {}

  @Get()
  async findAll(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.subsService.findAll(Number(limit) || 50, Number(offset) || 0);
  }

  @Get('stats')
  async getStats() {
    return this.subsService.getStats();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.subsService.findById(id);
  }

  @Patch(':id')
  async changePlan(@Param('id') id: string, @Body() body: { planId: string }) {
    return this.subsService.changePlan(id, body.planId);
  }

  @Post(':id/cancel')
  async forceCancel(@Param('id') id: string) {
    return this.subsService.forceCancel(id);
  }
}
