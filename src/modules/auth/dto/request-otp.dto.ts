import { z } from 'zod';

export const requestOtpSchema = z.object({
  email: z.string().email(),
});

export type RequestOtpDto = z.infer<typeof requestOtpSchema>;
