export interface JaafarHarnessPolicy {
  maxGraphSteps: number;
  maxToolCalls: number;
  maxRetriesPerTool: number;
  maxRuntimeMs: number;
  maxEstimatedCost?: number;
  maxOutputTokens?: number;
  allowParallelReadOnlyTools: boolean;
}

export type HarnessLimitName =
  | 'maxGraphSteps'
  | 'maxToolCalls'
  | 'maxRetriesPerTool'
  | 'maxRuntimeMs'
  | 'maxEstimatedCost'
  | 'maxOutputTokens';

export interface HarnessUsage {
  graphSteps: number;
  toolCalls: number;
  retriesByTool: Record<string, number>;
  estimatedCost?: number;
  outputTokens?: number;
}
