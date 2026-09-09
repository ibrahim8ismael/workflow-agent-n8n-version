import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_RUN_PHASE } from '../../runs/agent-run-phase';
import { AgentRunTraceService } from './agent-run-trace.service';

describe('AgentRunTraceService', () => {
  const agentRuns = { snapshot: vi.fn() };
  const service = () => new AgentRunTraceService(agentRuns as never);

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    agentId: 'agent-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    organizationId: 'org-1',
    status: 'COMPLETED',
    currentPhase: AGENT_RUN_PHASE.COMPLETED,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:01:00Z'),
    completedAt: new Date('2026-01-01T00:01:00Z'),
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    estimatedCost: 0.01,
    durationMs: 60000,
    metadata: {
      agentRunVersion: 'v2',
      runtimeEvents: [{ type: 'run.completed', runId: 'run-1', occurredAt: 't', payload: {} }],
    },
    requirements: [{ id: 'R1' }],
    assumptions: [],
    constraints: [],
    businessContext: 'retail',
    automationPlan: { goal: 'Sync orders' },
    validationResult: { valid: true, coverage: [{ requirementId: 'R1' }] },
    executionResults: {
      automationId: 'auto-1',
      externalWorkflowId: 'wf-1',
      webhookPath: 'orders-auto',
      automationVersion: 2,
    },
    repairAttempts: [{ attempt: 1, code: 'TIMEOUT' }],
    workflowId: 'wf-1',
    workflowVersion: 2,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    agentRuns.snapshot.mockResolvedValue({
      run: row(),
      transitions: [
        {
          createdAt: new Date('2026-01-01T00:00:30Z'),
          fromStatus: 'EXECUTING',
          toStatus: 'COMPLETED',
          fromPhase: 'RUNTIME_VALIDATION',
          toPhase: 'COMPLETED',
          reason: 'verified',
        },
      ],
    });
  });

  it('assembles the full run document from the snapshot', async () => {
    const trace = await service().trace('run-1');

    expect(trace).toMatchObject({
      runId: 'run-1',
      agentId: 'agent-1',
      agentRunVersion: 'v2',
      status: 'COMPLETED',
      phase: AGENT_RUN_PHASE.COMPLETED,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        estimatedCost: 0.01,
        durationMs: 60000,
      },
    });
    expect(trace.understanding.requirements).toEqual([{ id: 'R1' }]);
    expect(trace.plan).toMatchObject({ goal: 'Sync orders' });
    expect(trace.coverage).toEqual([{ requirementId: 'R1' }]);
    expect(trace.repairs).toHaveLength(1);
    expect(trace.automation).toMatchObject({
      automationId: 'auto-1',
      externalWorkflowId: 'wf-1',
      webhookPath: 'orders-auto',
      automationVersion: 2,
    });
    expect(trace.transitions).toEqual([
      {
        at: '2026-01-01T00:00:30.000Z',
        fromStatus: 'EXECUTING',
        toStatus: 'COMPLETED',
        fromPhase: 'RUNTIME_VALIDATION',
        toPhase: 'COMPLETED',
        reason: 'verified',
      },
    ]);
    expect(trace.events).toHaveLength(1);
  });

  it('degrades gracefully on sparse legacy rows', async () => {
    agentRuns.snapshot.mockResolvedValue({
      run: row({
        metadata: {},
        repairAttempts: null,
        validationResult: null,
        executionResults: null,
        workflowId: null,
        workflowVersion: null,
        completedAt: null,
        durationMs: null,
      }),
      transitions: [],
    });

    const trace = await service().trace('run-1');

    expect(trace.agentRunVersion).toBeNull();
    expect(trace.repairs).toEqual([]);
    expect(trace.completedAt).toBeNull();
    expect(trace.automation).toMatchObject({
      automationId: null,
      externalWorkflowId: null,
      automationVersion: null,
    });
    expect(trace.transitions).toEqual([]);
    expect(trace.events).toEqual([]);
  });
});
