import { z } from 'zod';

export const updateMemorySchema = z.object({
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
});

export type UpdateMemoryDto = z.infer<typeof updateMemorySchema>;
