import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import {
  HarnessLimitError,
  HarnessParallelismError,
  JaafarHarnessService,
} from './jaafar-harness.service';

const config = (values: Record<string, unknown> = {}) =>
  ({
    get: vi.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  }) as unknown as ConfigService;

describe('JaafarHarnessService', () => {
  it('uses safe default limits', () => {
    const service = new JaafarHarnessService(config());

    expect(service.getPolicy()).toMatchObject({
      maxGraphSteps: 30,
      maxToolCalls: 15,
      maxRetriesPerTool: 2,
      maxRuntimeMs: 300_000,
      allowParallelReadOnlyTools: true,
    });
  });

  it('reads configurable limits and boolean values', () => {
    const service = new JaafarHarnessService(
      config({
        JAAFAR_MAX_GRAPH_STEPS: '4',
        JAAFAR_MAX_ESTIMATED_COST: '1.5',
        JAAFAR_ALLOW_PARALLEL_READ_ONLY_TOOLS: 'false',
      }),
    );

    expect(service.getPolicy()).toMatchObject({
      maxGraphSteps: 4,
      maxEstimatedCost: 1.5,
      allowParallelReadOnlyTools: false,
    });
  });

  it('identifies the exact exceeded graph limit', () => {
    const service = new JaafarHarnessService(config());

    expect(() =>
      service.assertWithinLimits(
        {
          graphSteps: 31,
          toolCalls: 0,
          retriesByTool: {},
        },
        Date.now(),
      ),
    ).toThrowError(new HarnessLimitError('maxGraphSteps', 30, 31));
  });

  it('enforces the runtime limit against the persisted run start time', () => {
    const service = new JaafarHarnessService(config());

    expect(() =>
      service.assertWithinLimits(
        {
          graphSteps: 1,
          toolCalls: 0,
          retriesByTool: {},
        },
        Date.now() - 301_000,
      ),
    ).toThrow('maxRuntimeMs');
  });

  it('enforces tool calls, retries, cost, output, and runtime limits', () => {
    const service = new JaafarHarnessService(config());
    const policy = {
      maxGraphSteps: 10,
      maxToolCalls: 2,
      maxRetriesPerTool: 1,
      maxRuntimeMs: 10,
      maxEstimatedCost: 1,
      maxOutputTokens: 5,
      allowParallelReadOnlyTools: true,
    };

    expect(() =>
      service.assertWithinLimits(
        {
          graphSteps: 1,
          toolCalls: 3,
          retriesByTool: { search: 0 },
          estimatedCost: 0,
          outputTokens: 0,
        },
        Date.now(),
        policy,
      ),
    ).toThrow('maxToolCalls');
    expect(() =>
      service.assertWithinLimits(
        {
          graphSteps: 1,
          toolCalls: 1,
          retriesByTool: { search: 2 },
        },
        Date.now(),
        policy,
      ),
    ).toThrow('maxRetriesPerTool');
    expect(() =>
      service.assertWithinLimits(
        {
          graphSteps: 1,
          toolCalls: 1,
          retriesByTool: {},
          estimatedCost: 2,
        },
        Date.now(),
        policy,
      ),
    ).toThrow('maxEstimatedCost');
    expect(() =>
      service.assertWithinLimits(
        {
          graphSteps: 1,
          toolCalls: 1,
          retriesByTool: {},
          outputTokens: 6,
        },
        Date.now(),
        policy,
      ),
    ).toThrow('maxOutputTokens');
  });

  it('allows only configured read-only parallel tools', () => {
    const service = new JaafarHarnessService(config());
    const policy = service.getPolicy();

    expect(() => service.assertParallelTools(true, 2, policy)).not.toThrow();
    expect(() => service.assertParallelTools(false, 2, policy)).toThrow(HarnessParallelismError);
    expect(() =>
      service.assertParallelTools(true, 2, { ...policy, allowParallelReadOnlyTools: false }),
    ).toThrow(HarnessParallelismError);
  });

  it('stops cancelled execution', () => {
    const service = new JaafarHarnessService(config());

    expect(() => service.assertNotCancelled(true)).toThrow('cancelled');
    expect(() => service.assertNotCancelled(false)).not.toThrow();
  });
});
