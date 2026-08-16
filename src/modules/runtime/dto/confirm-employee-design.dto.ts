import { z } from 'zod';

export const confirmEmployeeDesignSchema = z.object({
  confirm: z.literal(true),
  blueprintRevision: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ConfirmEmployeeDesignDto = z.infer<typeof confirmEmployeeDesignSchema>;
