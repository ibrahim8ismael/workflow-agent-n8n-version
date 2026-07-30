import { z } from 'zod';

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  personality: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR']).optional(),
});

export type UpdateAgentDto = z.infer<typeof updateAgentSchema>;
