import { z } from 'zod';

export const createIntegrationSchema = z.object({
  name: z.string(),
  type: z.string(),
  config: z.record(z.unknown()).optional(),
  organizationId: z.string(),
});

export type CreateIntegrationDto = z.infer<typeof createIntegrationSchema>;
