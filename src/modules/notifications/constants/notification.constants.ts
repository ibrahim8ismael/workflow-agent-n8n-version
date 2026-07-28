export const NOTIFICATION_TYPES = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
