export class HardLimitReachedEvent {
  constructor(
    public readonly subscriptionId: string,
    public readonly resourceType: 'ai_credits' | 'operations',
    public readonly currentUsage: bigint,
    public readonly limit: bigint,
    public readonly userId?: string,
    public readonly organizationId?: string,
  ) {}
}
