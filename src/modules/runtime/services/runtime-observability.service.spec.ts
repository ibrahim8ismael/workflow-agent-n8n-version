import { describe, expect, it } from 'vitest';
import { RuntimeObservabilityService } from './runtime-observability.service';

describe('RuntimeObservabilityService', () => {
  it('aggregates redacted lifecycle metrics without storing prompt content', () => {
    const service = new RuntimeObservabilityService();
    service.record({
      type: 'graph.node.completed',
      runId: 'run-1',
      occurredAt: new Date().toISOString(),
      payload: { node: 'execute', durationMs: 12 },
    });
    service.record({
      type: 'tool.completed',
      runId: 'run-1',
      occurredAt: new Date().toISOString(),
      payload: { callId: 'call-1', toolName: 'lookup', durationMs: 8 },
    });
    service.record({
      type: 'run.completed',
      runId: 'run-1',
      occurredAt: new Date().toISOString(),
      payload: {
        response: 'safe response',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    });

    expect(service.snapshot()).toMatchObject({
      events: 3,
      completed: 1,
      totalNodeDurationMs: 12,
      totalToolDurationMs: 8,
    });
  });

  it('records model metadata and streaming latency without prompt content', () => {
    const service = new RuntimeObservabilityService();
    service.recordModel({
      executionId: 'execution-1',
      mode: 'medium',
      provider: 'openai',
      model: 'gpt-4o-mini',
      durationMs: 40,
      retries: 1,
      estimatedCost: 0.01,
    });
    service.recordFirstToken(15);

    expect(service.snapshot()).toMatchObject({
      modelCalls: 1,
      modelProviders: { 'openai:gpt-4o-mini': 1 },
      totalModelDurationMs: 40,
      firstTokenCount: 1,
      totalTimeToFirstTokenMs: 15,
    });
  });
});
