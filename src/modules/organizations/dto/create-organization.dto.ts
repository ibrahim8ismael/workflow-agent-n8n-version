import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
});

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;
