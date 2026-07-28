export const CHANNEL_TYPES = {
  SLACK: 'SLACK',
  DISCORD: 'DISCORD',
  TELEGRAM: 'TELEGRAM',
  WEB: 'WEB',
  API: 'API',
} as const;

export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES];
