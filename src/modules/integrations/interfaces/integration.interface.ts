export interface IIntegration {
  id: string;
  name: string;
  category: string;
  provider: string;
  status: string;
  config?: Record<string, unknown>;
  userId?: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}
