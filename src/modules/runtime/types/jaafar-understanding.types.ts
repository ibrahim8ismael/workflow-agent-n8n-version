import type { RuntimeIntent } from './runtime-contract.types';

export type UnderstandingSource = 'user' | 'history' | 'inferred' | 'retrieved';

export interface JaafarRequirement {
  field: string;
  value: string;
  required: boolean;
  source: UnderstandingSource;
}

export interface JaafarMissingInput {
  field: string;
  description: string;
  question: string;
  required: boolean;
}

export interface JaafarUnderstanding {
  intent: RuntimeIntent;
  goal: string;
  businessContext: string;
  requirements: JaafarRequirement[];
  missingInputs: JaafarMissingInput[];
  confidence: number;
  clarificationRequired: boolean;
  clarificationQuestion?: string;
}

export type JaafarUnderstandingRoute = RuntimeIntent | 'clarification';
