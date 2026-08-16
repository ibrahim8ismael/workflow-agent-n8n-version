import { Injectable, Logger } from '@nestjs/common';
import type { LLMExecutionMetadata } from '../../../infrastructure/llm-runtime/interfaces/llm-runtime.interface';
import type { RuntimeEvent } from '../types/runtime-contract.types';

export interface RuntimeHealthSnapshot {
  events: number;
  completed: number;
  failed: number;
  waiting: number;
  toolsStarted: number;
  toolsFailed: number;
  totalNodeDurationMs: number;
  totalToolDurationMs: number;
  modelCalls: number;
  modelProviders: Record<string, number>;
  totalModelDurationMs: number;
  firstTokenCount: number;
  totalTimeToFirstTokenMs: number;
}

@Injectable()
export class RuntimeObservabilityService {
  private readonly logger = new Logger(RuntimeObservabilityService.name);
  private readonly counters: RuntimeHealthSnapshot = {
    events: 0,
    completed: 0,
    failed: 0,
    waiting: 0,
    toolsStarted: 0,
    toolsFailed: 0,
    totalNodeDurationMs: 0,
    totalToolDurationMs: 0,
    modelCalls: 0,
    modelProviders: {},
    totalModelDurationMs: 0,
    firstTokenCount: 0,
    totalTimeToFirstTokenMs: 0,
  };

  record(event: RuntimeEvent): void {
    this.counters.events += 1;
    if (event.type === 'run.completed') this.counters.completed += 1;
    if (event.type === 'run.failed') this.counters.failed += 1;
    if (event.type === 'run.waiting') this.counters.waiting += 1;
    if (event.type === 'tool.started') this.counters.toolsStarted += 1;
    if (event.type === 'tool.failed') this.counters.toolsFailed += 1;
    if (event.type === 'tool.completed') {
      this.counters.totalToolDurationMs += event.payload.durationMs;
    }
    if (event.type === 'graph.node.completed') {
      this.counters.totalNodeDurationMs += event.payload.durationMs;
    }
    this.logger.debug({ runId: event.runId, event: event.type });
  }

  recordModel(execution: LLMExecutionMetadata): void {
    this.counters.modelCalls += 1;
    this.counters.totalModelDurationMs += execution.durationMs;
    const key = `${execution.provider}:${execution.model}`;
    this.counters.modelProviders[key] = (this.counters.modelProviders[key] ?? 0) + 1;
  }

  recordFirstToken(durationMs: number): void {
    this.counters.firstTokenCount += 1;
    this.counters.totalTimeToFirstTokenMs += Math.max(0, durationMs);
  }

  snapshot(): RuntimeHealthSnapshot {
    return { ...this.counters };
  }
}
