import { z } from 'zod';

export const purchaseTopUpSchema = z.object({
  packageId: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

export type PurchaseTopUpDto = z.infer<typeof purchaseTopUpSchema>;
