export class SubscriptionCreatedEvent {
  constructor(
    public readonly subscriptionId: string,
    public readonly userId?: string,
    public readonly organizationId?: string,
    public readonly planId?: string,
  ) {}
}
