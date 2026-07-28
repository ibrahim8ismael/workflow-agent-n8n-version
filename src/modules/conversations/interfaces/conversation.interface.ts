export interface IConversation {
  id: string;
  title: string;
  organizationId: string;
  participantIds: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
