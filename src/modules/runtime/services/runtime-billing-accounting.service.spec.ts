import { describe, expect, it, vi } from 'vitest';
import { RuntimeBillingAccountingService } from './runtime-billing-accounting.service';

const run = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-1',
  userId: 'user-1',
  organizationId: null,
  estimatedCost: 2.1,
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  ...overrides,
});

describe('RuntimeBillingAccountingService', () => {
  it('records AI credits and a run-scoped billing event once', async () => {
    const runs = { findById: vi.fn().mockResolvedValue(run()) };
    const subscriptions = {
      getCurrent: vi.fn().mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' }),
    };
    const usageMeter = { recordAiCreditsUsage: vi.fn().mockResolvedValue(undefined) };
    const billingEvents = {
      findByEntity: vi.fn().mockResolvedValue([]),
      logEvent: vi.fn().mockResolvedValue(undefined),
    };
    const service = new RuntimeBillingAccountingService(
      runs as never,
      subscriptions as never,
      usageMeter as never,
      billingEvents as never,
    );

    const result = await service.recordRun('run-1');

    expect(result).toEqual({ accounted: true, credits: 3n });
    expect(subscriptions.getCurrent).toHaveBeenCalledWith('user-1', undefined);
    expect(usageMeter.recordAiCreditsUsage).toHaveBeenCalledWith('sub-1', 3n);
    expect(billingEvents.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'runtime_run', entityId: 'run-1' }),
    );
  });

  it('does not charge a run that already has a billing event', async () => {
    const runs = { findById: vi.fn().mockResolvedValue(run()) };
    const subscriptions = {
      getCurrent: vi.fn().mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' }),
    };
    const usageMeter = { recordAiCreditsUsage: vi.fn() };
    const billingEvents = {
      findByEntity: vi.fn().mockResolvedValue([{ id: 'billing-event-1' }]),
      logEvent: vi.fn(),
    };
    const service = new RuntimeBillingAccountingService(
      runs as never,
      subscriptions as never,
      usageMeter as never,
      billingEvents as never,
    );

    await expect(service.recordRun('run-1')).resolves.toEqual({ accounted: true });
    expect(usageMeter.recordAiCreditsUsage).not.toHaveBeenCalled();
    expect(billingEvents.logEvent).not.toHaveBeenCalled();
  });

  it('does not charge runs without an active subscription', async () => {
    const runs = { findById: vi.fn().mockResolvedValue(run({ userId: null })) };
    const subscriptions = { getCurrent: vi.fn() };
    const usageMeter = { recordAiCreditsUsage: vi.fn() };
    const billingEvents = { findByEntity: vi.fn(), logEvent: vi.fn() };
    const service = new RuntimeBillingAccountingService(
      runs as never,
      subscriptions as never,
      usageMeter as never,
      billingEvents as never,
    );

    await expect(service.recordRun('run-1')).resolves.toEqual({ accounted: false });
    expect(subscriptions.getCurrent).not.toHaveBeenCalled();
  });
});
