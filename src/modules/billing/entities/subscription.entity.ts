export class Subscription {
  id!: string;
  organizationId!: string;
  planId!: string;
  status!: string;
  currentPeriodStart!: Date;
  currentPeriodEnd!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
