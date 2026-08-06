import { z } from 'zod';

export const executeRunSchema = z.object({
  userMessage: z.string().min(1),
  agentId: z.string().min(1),
  conversationId: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).default('medium'),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
});

export type ExecuteRunDto = z.infer<typeof executeRunSchema>;
