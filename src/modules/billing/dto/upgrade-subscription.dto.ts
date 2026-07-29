import { z } from 'zod';

export const upgradeSubscriptionSchema = z.object({
  planId: z.string().uuid(),
});

export type UpgradeSubscriptionDto = z.infer<typeof upgradeSubscriptionSchema>;
