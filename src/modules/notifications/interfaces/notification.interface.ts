export interface INotification {
  id: string;
  type: string;
  title: string;
  body: string;
  recipientId: string;
  organizationId?: string;
  read: boolean;
  createdAt: Date;
}
