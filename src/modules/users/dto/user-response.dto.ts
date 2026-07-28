import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
  emailVerifiedAt: z.string().datetime().optional(),
  role: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UserResponseDto = z.infer<typeof userResponseSchema>;
