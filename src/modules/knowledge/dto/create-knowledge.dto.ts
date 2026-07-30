import { z } from 'zod';

export const createKnowledgeDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  source: z.string().optional(),
  contentType: z.string().default('text'),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  organizationId: z.string().optional(),
  category: z.string().optional(),
});

export type CreateKnowledgeDocumentDto = z.infer<typeof createKnowledgeDocumentSchema>;
