import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  HarnessLimitName,
  HarnessUsage,
  JaafarHarnessPolicy,
} from '../interfaces/harness.interface';

export class HarnessLimitError extends Error {
  readonly code = 'GRAPH_LIMIT_REACHED' as const;

  constructor(
    readonly limitName: HarnessLimitName,
    readonly limit: number,
    readonly observed: number,
  ) {
    super(`Harness limit "${limitName}" reached: ${observed} exceeds ${limit}`);
    this.name = HarnessLimitError.name;
  }
}

@Injectable()
export class JaafarHarnessService {
  constructor(private readonly config: ConfigService) {}

  getPolicy(): JaafarHarnessPolicy {
    return {
      maxGraphSteps: this.number('JAAFAR_MAX_GRAPH_STEPS', 30),
      maxToolCalls: this.number('JAAFAR_MAX_TOOL_CALLS', 15),
      maxRetriesPerTool: this.number('JAAFAR_MAX_RETRIES_PER_TOOL', 2),
      maxRuntimeMs: this.number('JAAFAR_MAX_RUNTIME_MS', 300_000),
      maxEstimatedCost: this.optionalNumber('JAAFAR_MAX_ESTIMATED_COST'),
      maxOutputTokens: this.optionalNumber('JAAFAR_MAX_OUTPUT_TOKENS'),
      allowParallelReadOnlyTools: this.boolean('JAAFAR_ALLOW_PARALLEL_READ_ONLY_TOOLS', true),
    };
  }

  assertWithinLimits(usage: HarnessUsage, startedAt: number, policy = this.getPolicy()): void {
    this.assertLimit('maxGraphSteps', usage.graphSteps, policy.maxGraphSteps);
    this.assertLimit('maxToolCalls', usage.toolCalls, policy.maxToolCalls);
    for (const retries of Object.values(usage.retriesByTool)) {
      this.assertLimit('maxRetriesPerTool', retries, policy.maxRetriesPerTool);
    }
    this.assertLimit('maxRuntimeMs', Date.now() - startedAt, policy.maxRuntimeMs);
    this.assertOptionalLimit('maxEstimatedCost', usage.estimatedCost, policy.maxEstimatedCost);
    this.assertOptionalLimit('maxOutputTokens', usage.outputTokens, policy.maxOutputTokens);
  }

  assertParallelTools(readOnly: boolean, count: number, policy = this.getPolicy()): void {
    if (count > 1 && (!readOnly || !policy.allowParallelReadOnlyTools)) {
      throw new HarnessLimitError('maxToolCalls', count, count);
    }
  }

  assertNotCancelled(cancelled: boolean): void {
    if (cancelled) {
      throw new Error('Runtime execution was cancelled');
    }
  }

  private assertLimit(name: HarnessLimitName, observed: number, limit: number): void {
    if (observed > limit) throw new HarnessLimitError(name, limit, observed);
  }

  private assertOptionalLimit(
    name: 'maxEstimatedCost' | 'maxOutputTokens',
    observed: number | undefined,
    limit: number | undefined,
  ): void {
    if (observed !== undefined && limit !== undefined) this.assertLimit(name, observed, limit);
  }

  private number(key: string, fallback: number): number {
    const value = this.config.get<number | string>(key, fallback);
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private optionalNumber(key: string): number | undefined {
    const value = this.config.get<number | string | undefined>(key);
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private boolean(key: string, fallback: boolean): boolean {
    const value = this.config.get<boolean | string>(key, fallback);
    if (typeof value === 'boolean') return value;
    if (value === 'false') return false;
    if (value === 'true') return true;
    return fallback;
  }
}
