export const CONVERSATION_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  CLOSED: 'CLOSED',
} as const;

export type ConversationStatus = (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];
