import { z } from 'zod';

export const confirmEmployeeDesignSchema = z
  .object({
    confirm: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    blueprintRevision: z.string().optional(),
  })
  .refine((data) => data.confirm !== false && data.confirmed !== false, {
    message: 'Confirmation must be true',
  });

export type ConfirmEmployeeDesignDto = z.infer<typeof confirmEmployeeDesignSchema>;
