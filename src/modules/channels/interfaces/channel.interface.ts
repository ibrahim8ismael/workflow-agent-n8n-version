export interface IChannel {
  id: string;
  agentId: string;
  type: string;
  name?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
