import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string(),
  type: z.string(),
  organizationId: z.string(),
});

export type CreateChannelDto = z.infer<typeof createChannelSchema>;
