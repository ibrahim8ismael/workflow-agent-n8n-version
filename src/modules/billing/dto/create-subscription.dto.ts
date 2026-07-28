import { z } from 'zod';

export const createSubscriptionSchema = z.object({
  planId: z.string(),
});

export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;
