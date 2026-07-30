export const AGENT_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
  ERROR: 'ERROR',
} as const;

export type AgentStatus = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

export const AGENT_VISIBILITY = {
  PRIVATE: 'PRIVATE',
  ORGANIZATION: 'ORGANIZATION',
  PUBLIC: 'PUBLIC',
} as const;

export type AgentVisibility = (typeof AGENT_VISIBILITY)[keyof typeof AGENT_VISIBILITY];
