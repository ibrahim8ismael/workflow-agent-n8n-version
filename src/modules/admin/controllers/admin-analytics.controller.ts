import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAnalyticsService } from '../services/admin-analytics.service';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('dashboard')
  async getDashboard() {
    return this.analytics.getDashboard();
  }

  @Get('mrr')
  async getMrr() {
    return this.analytics.getMrr();
  }

  @Get('churn')
  async getChurn() {
    return this.analytics.getChurnRate();
  }

  @Get('credits-burn-rate')
  async getBurnRate(@Query('days') days?: string) {
    return this.analytics.getCreditsBurnRate(Number(days) || 30);
  }

  @Get('arpu')
  async getArpu() {
    return this.analytics.getArpu();
  }
}
