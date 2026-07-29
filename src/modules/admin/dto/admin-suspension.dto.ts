import { z } from 'zod';

export const suspensionSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type SuspensionDto = z.infer<typeof suspensionSchema>;
