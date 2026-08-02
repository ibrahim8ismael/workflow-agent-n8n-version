import { z } from 'zod';

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(255).optional(),
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
    .optional(),
  status: z.enum(['DRAFT', 'TESTING', 'PUBLISHED', 'ACTIVE', 'DEPRECATED', 'ARCHIVED']).optional(),
  visibility: z.enum(['PRIVATE', 'ORGANIZATION', 'PUBLIC']).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  instructions: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  retryPolicy: z.record(z.unknown()).optional(),
  successCriteria: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateSkillDto = z.infer<typeof updateSkillSchema>;
