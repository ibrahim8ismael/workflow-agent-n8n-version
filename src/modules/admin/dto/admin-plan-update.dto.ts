import { z } from 'zod';

export const planUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  isActive: z.boolean().optional(),
  features: z.record(z.unknown()).optional(),
});

export const planCreateSchema = z.object({
  tier: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  currency: z.string().default('USD'),
  interval: z.string().default('monthly'),
  features: z.record(z.unknown()).optional(),
});

export type PlanUpdateDto = z.infer<typeof planUpdateSchema>;
export type PlanCreateDto = z.infer<typeof planCreateSchema>;
