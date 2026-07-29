import { z } from 'zod';

export const createSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
});

export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;
