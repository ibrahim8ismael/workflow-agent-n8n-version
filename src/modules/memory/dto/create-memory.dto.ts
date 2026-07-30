import { z } from 'zod';

export const createMemorySchema = z.object({
  agentId: z.string(),
  type: z.enum(['CONVERSATION', 'USER', 'AGENT']),
  key: z.string().min(1).max(255),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

export type CreateMemoryDto = z.infer<typeof createMemorySchema>;
