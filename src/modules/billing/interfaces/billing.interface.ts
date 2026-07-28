export interface IBillingPlan {
  id: string;
  name: string;
  price: number;
  interval: string;
  features: string[];
}

export interface ISubscription {
  id: string;
  organizationId: string;
  planId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}
