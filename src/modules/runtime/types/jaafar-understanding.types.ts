import type { RuntimeIntent } from './runtime-contract.types';

export type UnderstandingSource = 'user' | 'history' | 'inferred' | 'retrieved';

export interface JaafarRequirement {
  /** Stable id (R1, R2, …) — the plan coverage map references these. */
  id?: string;
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

export type AssumptionRisk = 'low' | 'medium' | 'high';

export interface JaafarAssumption {
  statement: string;
  rationale: string;
  reversible: boolean;
  risk: AssumptionRisk;
  /** True when the user must confirm before Jaafar acts on it. */
  needsConfirmation?: boolean;
}

export interface JaafarTrigger {
  kind: 'webhook' | 'schedule' | 'manual' | 'chat' | 'none';
  event: string;
  schedule: string;
}

export interface JaafarUnderstanding {
  intent: RuntimeIntent;
  goal: string;
  businessContext: string;
  trigger: JaafarTrigger;
  actions: string[];
  entities: string[];
  conditions: string[];
  constraints: string[];
  desiredOutcome: string;
  requirements: JaafarRequirement[];
  assumptions: JaafarAssumption[];
  missingInputs: JaafarMissingInput[];
  confidence: number;
  clarificationRequired: boolean;
  clarificationQuestion?: string;
  /**
   * Explicit generic-node override (mirrors the Zod schema). Only set when
   * the user explicitly requests HTTP/API or Code implementation.
   */
  genericNodeOverride?: {
    requested: boolean;
    type?: 'httpRequest' | 'code';
  };
}

export type JaafarUnderstandingRoute = RuntimeIntent | 'clarification';
