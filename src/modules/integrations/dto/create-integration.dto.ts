import { z } from 'zod';

export const createIntegrationSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.enum(['AI', 'COMMUNICATION', 'CRM', 'PAYMENT', 'ANALYTICS', 'STORAGE', 'OTHER']),
  provider: z.string(),
  config: z.record(z.unknown()).optional(),
  organizationId: z.string().optional(),
});

export type CreateIntegrationDto = z.infer<typeof createIntegrationSchema>;
