import { z } from 'zod';

export const searchKnowledgeSchema = z.object({
  query: z.string().min(1),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().int().positive().max(50).default(10),
  offset: z.number().int().min(0).default(0),
});

export type SearchKnowledgeDto = z.infer<typeof searchKnowledgeSchema>;
