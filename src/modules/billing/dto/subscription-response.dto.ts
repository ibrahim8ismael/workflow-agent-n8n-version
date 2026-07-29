export class SubscriptionResponseDto {
  id!: string;
  planId!: string;
  planName!: string;
  planTier!: string;
  status!: string;
  currentPeriodStart!: Date;
  currentPeriodEnd!: Date;
  trialEndsAt?: Date | null;
  canceledAt?: Date | null;
  userId?: string | null;
  organizationId?: string | null;
}
