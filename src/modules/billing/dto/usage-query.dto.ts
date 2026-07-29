import { z } from 'zod';

export const usageQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

export type UsageQueryDto = z.infer<typeof usageQuerySchema>;
