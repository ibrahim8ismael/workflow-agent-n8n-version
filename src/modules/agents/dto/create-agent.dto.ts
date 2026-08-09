import { z } from 'zod';

export const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  instructions: z.string().optional(),
  personality: z.string().optional(),
  model: z.string().default('gpt-4o'),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']).default('DRAFT'),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
});

export type CreateAgentDto = z.infer<typeof createAgentSchema>;
