import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string(),
  organizationId: z.string(),
  participantIds: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateConversationDto = z.infer<typeof createConversationSchema>;
