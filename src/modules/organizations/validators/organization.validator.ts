import { z } from 'zod';

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type OrganizationValidator = z.infer<typeof organizationSchema>;
