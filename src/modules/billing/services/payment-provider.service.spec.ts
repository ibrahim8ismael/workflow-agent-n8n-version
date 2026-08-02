import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentProviderService } from './payment-provider.service';

describe('PaymentProviderService', () => {
  let service: PaymentProviderService;

  beforeEach(() => {
    service = new PaymentProviderService();
  });

  describe('createSubscription', () => {
    it('should create a stub subscription with a monthly period', async () => {
      const result = await service.createSubscription('cust-1', 'plan-1');

      expect(result.providerSubscriptionId).toMatch(/^stub_cust-1_plan-1_/);
      expect(result.status).toBe('active');
      expect(result.currentPeriodStart).toBeInstanceOf(Date);
      expect(result.currentPeriodEnd).toBeInstanceOf(Date);
      expect(result.currentPeriodEnd.getTime()).toBeGreaterThan(
        result.currentPeriodStart.getTime(),
      );
    });
  });

  describe('cancelSubscription', () => {
    it('should resolve without error', async () => {
      await expect(service.cancelSubscription('prov-1')).resolves.toBeUndefined();
    });
  });

  describe('updateSubscription', () => {
    it('should return the updated subscription with a new period', async () => {
      const result = await service.updateSubscription('prov-1', 'plan-2');

      expect(result.providerSubscriptionId).toBe('prov-1');
      expect(result.status).toBe('active');
      expect(result.currentPeriodEnd.getTime()).toBeGreaterThan(
        result.currentPeriodStart.getTime(),
      );
    });
  });

  describe('createPaymentIntent', () => {
    it('should create a stub payment intent', async () => {
      const result = await service.createPaymentIntent(499, 'USD');

      expect(result.providerPaymentId).toMatch(/^pi_stub_/);
      expect(result.status).toBe('requires_confirmation');
      expect(result.amount).toBe(499);
      expect(result.currency).toBe('USD');
    });
  });

  describe('refundPayment', () => {
    it('should resolve without error', async () => {
      await expect(service.refundPayment('pi_stub_1', 100)).resolves.toBeUndefined();
    });
  });

  describe('handleWebhook', () => {
    it('should return an unknown event with the payload', async () => {
      const result = await service.handleWebhook({ event: 'x' }, 'sig');

      expect(result).toEqual({ type: 'unknown', data: { event: 'x' } });
    });
  });
});
