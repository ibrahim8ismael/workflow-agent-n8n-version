import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSubscriptionsRepository } from '../repositories/admin-subscriptions.repository';
import { AdminSubscriptionsService } from './admin-subscriptions.service';

describe('AdminSubscriptionsService', () => {
  let service: AdminSubscriptionsService;

  const sub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    planId: 'plan-1',
    status: 'ACTIVE',
    ...overrides,
  });

  const mockRepo = {
    findAll: vi.fn(),
    findById: vi.fn(),
    forceCancel: vi.fn(),
    updatePlan: vi.fn(),
    countByStatus: vi.fn(),
    totalRevenue: vi.fn(),
  } as unknown as AdminSubscriptionsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findAll).mockResolvedValue([sub()] as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(sub() as never);
    vi.mocked(mockRepo.forceCancel).mockResolvedValue(sub({ status: 'CANCELED' }) as never);
    vi.mocked(mockRepo.updatePlan).mockResolvedValue(sub({ planId: 'plan-2' }) as never);
    vi.mocked(mockRepo.countByStatus).mockResolvedValue({ ACTIVE: 3, CANCELED: 1 } as never);
    vi.mocked(mockRepo.totalRevenue).mockResolvedValue(1000 as never);
    service = new AdminSubscriptionsService(mockRepo);
  });

  it('should list subscriptions with pagination', async () => {
    await service.findAll(20, 0);

    expect(mockRepo.findAll).toHaveBeenCalledWith(20, 0);
  });

  it('should return the subscription when found', async () => {
    const result = await service.findById('sub-1');

    expect(result.id).toBe('sub-1');
  });

  it('should throw when the subscription is missing', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('should force-cancel an existing subscription', async () => {
    const result = await service.forceCancel('sub-1');

    expect(mockRepo.forceCancel).toHaveBeenCalledWith('sub-1');
    expect(result.status).toBe('CANCELED');
  });

  it('should change the plan of an existing subscription', async () => {
    const result = await service.changePlan('sub-1', 'plan-2');

    expect(mockRepo.updatePlan).toHaveBeenCalledWith('sub-1', 'plan-2');
    expect(result.planId).toBe('plan-2');
  });

  it('should return stats with revenue', async () => {
    const result = await service.getStats();

    expect(result).toEqual({ byStatus: { ACTIVE: 3, CANCELED: 1 }, totalRevenue: 1000 });
  });
});
