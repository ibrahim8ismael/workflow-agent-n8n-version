import { z } from 'zod';

export const inboundChannelMessageSchema = z.object({
  channelType: z.enum([
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
  channelIdentifier: z.string().min(1),
  externalUserId: z.string().min(1),
  externalMessageId: z.string().optional(),
  externalConversationId: z.string().optional(),
  agentId: z.string().optional(),
  sender: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
    })
    .optional(),
  message: z.object({
    type: z.string().default('text'),
    content: z.string().min(1),
    attachments: z
      .array(
        z.object({
          type: z.string(),
          url: z.string().url(),
          name: z.string().optional(),
        }),
      )
      .optional(),
  }),
  metadata: z.record(z.unknown()).optional(),
});

export type InboundChannelMessageDto = z.infer<typeof inboundChannelMessageSchema>;
