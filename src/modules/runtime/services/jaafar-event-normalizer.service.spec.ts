import { describe, expect, it } from 'vitest';
import { JaafarEventNormalizerService } from './jaafar-event-normalizer.service';

describe('JaafarEventNormalizerService', () => {
  const service = new JaafarEventNormalizerService();

  it('preserves the existing top-level token SSE shape', () => {
    expect(
      service.normalize('run-1', {
        type: 'token',
        content: 'Hello',
        occurredAt: '2026-08-11T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'token',
      runId: 'run-1',
      occurredAt: '2026-08-11T00:00:00.000Z',
      content: 'Hello',
    });
  });

  it('normalizes graph and tool lifecycle events', () => {
    expect(
      service.normalize('run-1', {
        type: 'tool.completed',
        callId: 'call-1',
        toolName: 'search',
        durationMs: 42,
        result: { count: 2 },
      }),
    ).toMatchObject({
      type: 'tool.completed',
      runId: 'run-1',
      callId: 'call-1',
      toolName: 'search',
      durationMs: 42,
      result: { count: 2 },
    });
  });

  it('redacts sensitive tool arguments and nested results', () => {
    const normalized = service.normalize('run-1', {
      type: 'tool.started',
      callId: 'call-1',
      toolName: 'send-email',
      args: {
        recipient: 'person@example.com',
        password: 'do-not-leak',
        nested: { accessToken: 'also-do-not-leak' },
      },
    });

    expect(normalized).toMatchObject({
      args: {
        recipient: 'person@example.com',
        password: '[REDACTED]',
        nested: { accessToken: '[REDACTED]' },
      },
    });
  });

  it('normalizes approval, waiting, completion, failure, and cancellation events', () => {
    expect(
      service.normalize('run-1', { type: 'approval.required', reason: 'side effect' }).type,
    ).toBe('approval.required');
    expect(service.normalize('run-1', { type: 'run.waiting', reason: 'approval' }).type).toBe(
      'run.waiting',
    );
    expect(
      service.normalize('run-1', {
        type: 'run.completed',
        response: 'Complete',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      }).type,
    ).toBe('run.completed');
    expect(
      service.normalize('run-1', {
        type: 'run.failed',
        error: { code: 'UNKNOWN_RUNTIME_FAILURE', message: 'Failed', retryable: false },
      }).type,
    ).toBe('run.failed');
    expect(service.normalize('run-1', { type: 'run.cancelled' }).type).toBe('run.cancelled');
  });
});
