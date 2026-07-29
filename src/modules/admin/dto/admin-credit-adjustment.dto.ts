import { z } from 'zod';

export const creditAdjustmentSchema = z.object({
  credits: z.string().regex(/^-?\d+$/, 'Must be an integer string'),
  description: z.string().min(1).max(500),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
});

export type CreditAdjustmentDto = z.infer<typeof creditAdjustmentSchema>;
