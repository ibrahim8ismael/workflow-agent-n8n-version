export interface IIntegration {
  id: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
  organizationId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
