export class SubscriptionCanceledEvent {
  constructor(
    public readonly subscriptionId: string,
    public readonly userId?: string,
    public readonly organizationId?: string,
  ) {}
}
