import { z } from 'zod';

export const updateUserSchema = z.object({
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
