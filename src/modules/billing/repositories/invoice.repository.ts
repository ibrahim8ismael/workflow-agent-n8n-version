import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class InvoiceRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string) {
    return this.db.invoice.findUnique({ where: { id, deletedAt: null } });
  }

  async findBySubscriptionId(subscriptionId: string) {
    return this.db.invoice.findMany({
      where: { subscriptionId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    subscriptionId: string;
    amount: number;
    currency?: string;
    status?: string;
    providerInvoiceId?: string;
    dueDate?: Date;
  }) {
    return this.db.invoice.create({ data });
  }

  async updateStatus(id: string, status: string, paidAt?: Date) {
    return this.db.invoice.update({
      where: { id },
      data: { status, paidAt: paidAt ?? (status === 'PAID' ? new Date() : undefined) },
    });
  }
}
