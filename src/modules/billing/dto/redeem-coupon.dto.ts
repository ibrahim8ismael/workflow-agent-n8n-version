import { z } from 'zod';

export const redeemCouponSchema = z.object({
  code: z.string().min(1).max(50),
});

export type RedeemCouponDto = z.infer<typeof redeemCouponSchema>;
