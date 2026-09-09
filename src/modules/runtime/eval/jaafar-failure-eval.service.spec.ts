import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunTrace } from '../services/agent-run-trace.service';
import { JaafarFailureEvalService } from './jaafar-failure-eval.service';

const trace = (overrides: Partial<AgentRunTrace> = {}): AgentRunTrace =>
  ({
    runId: 'run-12345678',
    agentId: 'agent-1',
    conversationId: null,
    userId: null,
    organizationId: null,
    agentRunVersion: 'v2',
    status: 'FAILED',
    phase: 'FAILED',
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      durationMs: null,
    },
    understanding: {
      goal: null,
      requirements: null,
      assumptions: null,
      constraints: null,
      businessContext: null,
    },
    plan: { goal: 'Sync orders' },
    validation: null,
    execution: null,
    repairs: [],
    coverage: null,
    automation: {
      automationId: null,
      externalWorkflowId: null,
      webhookPath: null,
      automationVersion: null,
    },
    transitions: [],
    events: [],
    ...overrides,
  }) as AgentRunTrace;

describe('JaafarFailureEvalService', () => {
  const traces = { trace: vi.fn() };
  const service = () => new JaafarFailureEvalService(traces as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('drafts a reviewable regression case from a failed run trace', async () => {
    traces.trace.mockResolvedValue(
      trace({
        transitions: [
          {
            at: 't',
            fromStatus: 'EXECUTING',
            toStatus: 'FAILED',
            fromPhase: 'RUNTIME_VALIDATION',
            toPhase: 'FAILED',
            reason: 'provision failed: n8n API key rejected',
          },
        ],
      }),
    );

    const draft = await service().draftRegressionFromRun('run-12345678');

    expect(draft).toMatchObject({
      id: 'regression-run-1234',
      category: 'failure',
      offline: {
        kind: 'classify-error',
        stage: 'provision',
        expectedCode: 'CREDENTIAL_ERROR',
      },
    });
    expect(draft.notes).toContain('Review');
    expect(traces.trace).toHaveBeenCalledWith('run-12345678');
  });

  it('returns a null offline case when the failure is untraceable', () => {
    const draft = service().draftRegression(trace({ status: 'COMPLETED', phase: 'COMPLETED' }));

    expect(draft.offline).toBeNull();
    expect(draft.id).toBe('regression-run-1234');
  });

  it('prefers the latest repair diagnosis as the error source', () => {
    const draft = service().draftRegression(
      trace({
        repairs: [{ diagnosis: 'Zoho credential rejected (401)' }],
      }),
    );

    expect(draft.offline).toMatchObject({
      message: 'Zoho credential rejected (401)',
      expectedCode: 'CREDENTIAL_ERROR',
    });
  });
});
