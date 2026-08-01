import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceRepository } from '../repositories/invoice.repository';

@Injectable()
export class InvoiceService {
  constructor(private readonly invoiceRepo: InvoiceRepository) {}

  async findBySubscriptionId(subscriptionId: string) {
    return this.invoiceRepo.findBySubscriptionId(subscriptionId);
  }

  async findById(id: string) {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async create(data: {
    subscriptionId: string;
    amount: number;
    currency?: string;
    dueDate?: Date;
  }) {
    return this.invoiceRepo.create({
      ...data,
      status: 'PENDING',
    });
  }

  async markPaid(id: string) {
    return this.invoiceRepo.updateStatus(id, 'PAID');
  }

  async markFailed(id: string) {
    return this.invoiceRepo.updateStatus(id, 'FAILED');
  }
}
