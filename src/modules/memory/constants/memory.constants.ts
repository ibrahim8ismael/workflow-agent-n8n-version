export const MEMORY_TYPE = {
  CONVERSATION: 'CONVERSATION',
  USER: 'USER',
  AGENT: 'AGENT',
} as const;

export type MemoryType = (typeof MEMORY_TYPE)[keyof typeof MEMORY_TYPE];

export const MEMORY_SOURCE = {
  CONVERSATION: 'conversation',
  SKILL: 'skill',
  HUMAN: 'human',
  API: 'api',
  IMPORT: 'import',
} as const;

export type MemorySource = (typeof MEMORY_SOURCE)[keyof typeof MEMORY_SOURCE];
