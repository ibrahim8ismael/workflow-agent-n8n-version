import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_RUN_PHASE } from '../../runs/agent-run-phase';
import { JaafarQualityMetricsService } from './jaafar-quality-metrics.service';

describe('JaafarQualityMetricsService', () => {
  const runs = { list: vi.fn() };
  const service = () => new JaafarQualityMetricsService(runs as never);

  const row = (overrides: Record<string, unknown> = {}) => ({
    status: 'COMPLETED',
    currentPhase: AGENT_RUN_PHASE.COMPLETED,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    estimatedCost: 0.1,
    durationMs: 1000,
    metadata: {},
    validationResult: null,
    repairAttempts: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('computes success, validation, repair and cost metrics over a window', async () => {
    runs.list.mockResolvedValue([
      row(),
      row({
        status: 'FAILED',
        currentPhase: AGENT_RUN_PHASE.FAILED,
        repairAttempts: [{ attempt: 1 }, { attempt: 2 }],
        validationResult: { valid: false },
      }),
      row({
        status: 'COMPLETED',
        repairAttempts: [{ attempt: 1 }],
        validationResult: { valid: true },
        metadata: { clarificationQuestion: 'Which channel?' },
      }),
      row({ status: 'WAITING', currentPhase: AGENT_RUN_PHASE.BUILDING, durationMs: null }),
    ]);

    const metrics = await service().metrics({});

    expect(metrics.window.runs).toBe(4);
    expect(metrics.statusCounts).toMatchObject({ COMPLETED: 2, FAILED: 1, WAITING: 1 });
    expect(metrics.successRate).toBeCloseTo(2 / 3);
    expect(metrics.failureRate).toBeCloseTo(1 / 3);
    expect(metrics.waitingRate).toBeCloseTo(1 / 4);
    expect(metrics.clarificationRate).toBeCloseTo(1 / 4);
    expect(metrics.validationPassRate).toBeCloseTo(1 / 2);
    expect(metrics.repair).toMatchObject({
      attempted: 2,
      repaired: 1,
      repairSuccessRate: 0.5,
      avgAttempts: 1.5,
    });
    expect(metrics.averages.durationMs).toBeCloseTo(1000);
    expect(metrics.totals.estimatedCost).toBeCloseTo(0.4);
  });

  it('returns null rates on an empty window', async () => {
    runs.list.mockResolvedValue([]);

    const metrics = await service().metrics({ since: new Date('2026-01-01') });

    expect(metrics.window).toMatchObject({ runs: 0, since: '2026-01-01T00:00:00.000Z' });
    expect(metrics.successRate).toBeNull();
    expect(metrics.repair.repairSuccessRate).toBeNull();
    expect(metrics.averages.durationMs).toBeNull();
  });

  it('scopes and bounds the window query', async () => {
    runs.list.mockResolvedValue([]);

    await service().metrics({
      since: new Date('2026-02-01'),
      organizationId: 'org-1',
      agentId: 'agent-1',
      limit: 5000,
    });

    expect(runs.list).toHaveBeenCalledWith({
      where: {
        createdAt: { gte: new Date('2026-02-01') },
        organizationId: 'org-1',
        agentId: 'agent-1',
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
  });
});
