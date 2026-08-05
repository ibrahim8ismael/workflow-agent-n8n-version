export const KNOWLEDGE_SOURCE = {
  MANUAL: 'manual',
  PDF: 'pdf',
  WEBSITE: 'website',
  API: 'api',
  NOTION: 'notion',
  GOOGLE_DRIVE: 'google_drive',
  CONFLUENCE: 'confluence',
  HELP_CENTER: 'help_center',
} as const;

export type KnowledgeSource = (typeof KNOWLEDGE_SOURCE)[keyof typeof KNOWLEDGE_SOURCE];

export const KNOWLEDGE_CATEGORY = {
  COMPANY: 'company',
  BUSINESS_MODEL: 'business_model',
  PRODUCTS: 'products',
  SERVICES: 'services',
  PRICING: 'pricing',
  POLICIES: 'policies',
  FAQS: 'faqs',
  PROCESSES: 'processes',
  DOCUMENTATION: 'documentation',
  COMPLIANCE: 'compliance',
  LEGAL: 'legal',
  TRAINING: 'training',
} as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORY)[keyof typeof KNOWLEDGE_CATEGORY];

export const KNOWLEDGE_MAX_CONTENT_BYTES = 5 * 1024 * 1024;
