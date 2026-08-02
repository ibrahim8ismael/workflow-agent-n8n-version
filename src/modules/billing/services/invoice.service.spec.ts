import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { InvoiceService } from './invoice.service';

describe('InvoiceService', () => {
  let service: InvoiceService;

  const invoice = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    subscriptionId: 'sub-1',
    amount: 100,
    status: 'PENDING',
    ...overrides,
  });

  const mockRepo = {
    findBySubscriptionId: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
  } as unknown as InvoiceRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findById).mockResolvedValue(invoice() as never);
    vi.mocked(mockRepo.create).mockResolvedValue(invoice() as never);
    vi.mocked(mockRepo.updateStatus).mockResolvedValue(invoice() as never);
    service = new InvoiceService(mockRepo);
  });

  it('should list invoices by subscription', async () => {
    await service.findBySubscriptionId('sub-1');

    expect(mockRepo.findBySubscriptionId).toHaveBeenCalledWith('sub-1');
  });

  it('should return an invoice when found', async () => {
    const result = await service.findById('inv-1');

    expect(result).toMatchObject({ id: 'inv-1' });
  });

  it('should throw when the invoice is missing', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('should create an invoice with PENDING status', async () => {
    await service.create({ subscriptionId: 'sub-1', amount: 100, currency: 'USD' });

    expect(mockRepo.create).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      amount: 100,
      currency: 'USD',
      status: 'PENDING',
    });
  });

  it('should mark an invoice as paid', async () => {
    await service.markPaid('inv-1');

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('inv-1', 'PAID');
  });

  it('should mark an invoice as failed', async () => {
    await service.markFailed('inv-1');

    expect(mockRepo.updateStatus).toHaveBeenCalledWith('inv-1', 'FAILED');
  });
});
