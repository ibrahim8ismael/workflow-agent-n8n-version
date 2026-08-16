import { z } from 'zod';

export const createSkillSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().optional(),
  executionMode: z
    .enum([
      'AI_ONLY',
      'N8N_WORKFLOW',
      'KNOWLEDGE_RETRIEVAL',
      'MEMORY_RETRIEVAL',
      'HYBRID',
      'HUMAN_APPROVAL',
    ])
    .default('AI_ONLY'),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  instructions: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  retryPolicy: z.record(z.unknown()).optional(),
  successCriteria: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
});

export type CreateSkillDto = z.infer<typeof createSkillSchema>;
