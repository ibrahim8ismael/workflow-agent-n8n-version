import { Injectable, NotFoundException } from '@nestjs/common';
import type { AdminOrganizationsRepository } from '../repositories/admin-organizations.repository';

@Injectable()
export class AdminOrganizationsService {
  constructor(private readonly repo: AdminOrganizationsRepository) {}

  async findAll(limit?: number, offset?: number) {
    return this.repo.findAll(limit, offset);
  }

  async findById(id: string) {
    const org = await this.repo.findById(id);
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async suspend(id: string) {
    const org = await this.repo.findById(id);
    if (!org) throw new NotFoundException('Organization not found');
    return this.repo.suspend(id);
  }

  async reactivate(id: string) {
    return this.repo.reactivate(id);
  }

  async getStats() {
    const total = await this.repo.count();
    return { total };
  }
}
