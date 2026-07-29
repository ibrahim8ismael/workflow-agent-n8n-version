import { z } from 'zod';

export const impersonationSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type ImpersonationDto = z.infer<typeof impersonationSchema>;
