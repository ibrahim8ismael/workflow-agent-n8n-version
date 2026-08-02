export interface IAgent {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  personality?: string;
  model: string;
  status: string;
  userId?: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}
