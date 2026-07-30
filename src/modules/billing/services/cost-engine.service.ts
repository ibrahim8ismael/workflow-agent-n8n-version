import { Injectable } from '@nestjs/common';
import type {
  CostCalculationResult,
  CostEngineInterface,
} from '../interfaces/cost-engine.interface';

@Injectable()
export class CostEngineService implements CostEngineInterface {
  private readonly modelCostMultipliers: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.5, output: 1.5 },
    'gpt-4': { input: 3, output: 12 },
    'claude-3-opus': { input: 3, output: 15 },
    'claude-3-sonnet': { input: 1.5, output: 6 },
    'claude-3-haiku': { input: 0.25, output: 1 },
    'gemini-1.5-pro': { input: 1.5, output: 5 },
    'gemini-1.5-flash': { input: 0.15, output: 0.6 },
    'llama-3-70b': { input: 0.5, output: 1.5 },
    'llama-3-8b': { input: 0.1, output: 0.3 },
    default: { input: 1, output: 3 },
  };

  calculateAiCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    _latencyMs: number,
  ): bigint {
    const multipliers = this.modelCostMultipliers[model] ?? this.modelCostMultipliers.default;
    const cost = (inputTokens * multipliers.input + outputTokens * multipliers.output) / 1000;
    return BigInt(Math.max(1, Math.ceil(cost)));
  }

  calculateOperationCost(
    operationType: string,
    _durationMs?: number,
    _payloadSize?: number,
  ): bigint {
    const baseCosts: Record<string, number> = {
      http: 10,
      code: 25,
      database: 15,
      loop: 5,
      browser: 50,
      email: 5,
      webhook: 10,
      cron: 10,
      queue: 5,
      background: 10,
    };
    const cost = baseCosts[operationType] ?? 10;
    return BigInt(cost);
  }

  calculateTotal(
    model: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    operationType: string,
    durationMs?: number,
    payloadSize?: number,
  ): CostCalculationResult {
    const creditsConsumed = this.calculateAiCost(model, inputTokens, outputTokens, latencyMs);
    const operationsConsumed = this.calculateOperationCost(operationType, durationMs, payloadSize);

    return {
      creditsConsumed,
      operationsConsumed,
      breakdown: { ai: creditsConsumed, ops: operationsConsumed },
    };
  }
}
