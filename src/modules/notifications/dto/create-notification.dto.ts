import { z } from 'zod';

export const createNotificationSchema = z.object({
  type: z.string(),
  title: z.string(),
  body: z.string(),
  recipientId: z.string(),
  organizationId: z.string().optional(),
});

export type CreateNotificationDto = z.infer<typeof createNotificationSchema>;
