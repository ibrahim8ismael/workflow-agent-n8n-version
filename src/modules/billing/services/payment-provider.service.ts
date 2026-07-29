import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProviderInterface,
  ProviderSubscriptionResult,
  ProviderPaymentResult,
  WebhookEvent,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class PaymentProviderService implements PaymentProviderInterface {
  private readonly logger = new Logger(PaymentProviderService.name);

  async createSubscription(
    customerId: string,
    planId: string,
    _metadata?: Record<string, unknown>,
  ): Promise<ProviderSubscriptionResult> {
    this.logger.log(`Creating subscription: customer=${customerId}, plan=${planId}`);
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return {
      providerSubscriptionId: `stub_${customerId}_${planId}_${Date.now()}`,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    this.logger.log(`Canceling subscription: ${providerSubscriptionId}`);
  }

  async updateSubscription(
    providerSubscriptionId: string,
    planId: string,
  ): Promise<ProviderSubscriptionResult> {
    this.logger.log(`Updating subscription: ${providerSubscriptionId} to plan ${planId}`);
    const now = new Date();
    return {
      providerSubscriptionId,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
    };
  }

  async createPaymentIntent(
    amount: number,
    currency: string,
    _metadata?: Record<string, unknown>,
  ): Promise<ProviderPaymentResult> {
    this.logger.log(`Creating payment intent: amount=${amount} ${currency}`);
    return {
      providerPaymentId: `pi_stub_${Date.now()}`,
      status: 'requires_confirmation',
      amount,
      currency,
    };
  }

  async refundPayment(providerPaymentIntentId: string, amount?: number): Promise<void> {
    this.logger.log(`Refunding payment: ${providerPaymentIntentId}, amount=${amount}`);
  }

  async handleWebhook(payload: unknown, _signature: string): Promise<WebhookEvent> {
    this.logger.log(`Handling webhook event`);
    return {
      type: 'unknown',
      data: payload as Record<string, unknown>,
    };
  }
}
