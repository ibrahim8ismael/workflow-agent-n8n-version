export interface CostEngineInterface {
  calculateAiCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
  ): bigint;
  calculateOperationCost(operationType: string, durationMs?: number, payloadSize?: number): bigint;
}

export interface CostCalculationResult {
  creditsConsumed: bigint;
  operationsConsumed: bigint;
  breakdown: Record<string, bigint>;
}
