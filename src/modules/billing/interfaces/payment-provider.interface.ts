export interface PaymentProviderInterface {
  createSubscription(
    customerId: string,
    planId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProviderSubscriptionResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  updateSubscription(
    providerSubscriptionId: string,
    planId: string,
  ): Promise<ProviderSubscriptionResult>;
  createPaymentIntent(
    amount: number,
    currency: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProviderPaymentResult>;
  refundPayment(providerPaymentIntentId: string, amount?: number): Promise<void>;
  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>;
}

export interface ProviderSubscriptionResult {
  providerSubscriptionId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface ProviderPaymentResult {
  providerPaymentId: string;
  status: string;
  amount: number;
  currency: string;
}

export interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
}
