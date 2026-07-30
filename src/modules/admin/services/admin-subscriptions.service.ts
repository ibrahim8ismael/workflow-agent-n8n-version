import { Injectable, NotFoundException } from '@nestjs/common';
import type { AdminSubscriptionsRepository } from '../repositories/admin-subscriptions.repository';

@Injectable()
export class AdminSubscriptionsService {
  constructor(private readonly repo: AdminSubscriptionsRepository) {}

  async findAll(limit?: number, offset?: number) {
    return this.repo.findAll(limit, offset);
  }

  async findById(id: string) {
    const sub = await this.repo.findById(id);
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async forceCancel(id: string) {
    await this.findById(id);
    return this.repo.forceCancel(id);
  }

  async changePlan(id: string, planId: string) {
    await this.findById(id);
    return this.repo.updatePlan(id, planId);
  }

  async getStats() {
    const byStatus = await this.repo.countByStatus();
    const revenue = await this.repo.totalRevenue();
    return { byStatus, totalRevenue: revenue };
  }
}
