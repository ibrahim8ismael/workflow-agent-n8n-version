import { z } from 'zod';

export const createRunSchema = z.object({
  agentId: z.string(),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateRunDto = z.infer<typeof createRunSchema>;
