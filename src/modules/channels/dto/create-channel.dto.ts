import { z } from 'zod';

export const createChannelSchema = z.object({
  agentId: z.string(),
  type: z.enum([
    'WIDGET',
    'WHATSAPP',
    'MESSENGER',
    'INSTAGRAM',
    'TELEGRAM',
    'EMAIL',
    'SLACK',
    'DISCORD',
    'API',
  ]),
  name: z.string().optional(),
});

export type CreateChannelDto = z.infer<typeof createChannelSchema>;
