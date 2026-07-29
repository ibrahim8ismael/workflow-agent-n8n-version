export class SubscriptionDowngradedEvent {
  constructor(
    public readonly subscriptionId: string,
    public readonly oldPlanId: string,
    public readonly newPlanId: string,
    public readonly userId?: string,
    public readonly organizationId?: string,
  ) {}
}
