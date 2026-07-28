import { z } from 'zod';

export const updateOrganizationSchema = z.object({
  name: z.string().optional(),
  logoUrl: z.string().optional(),
});

export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;
