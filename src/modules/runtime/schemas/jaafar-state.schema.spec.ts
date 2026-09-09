import { describe, expect, it } from 'vitest';
import type { JaafarState } from '../interfaces/jaafar-state.interface';
import { deserializeJaafarState, serializeJaafarState } from './jaafar-state.schema';

const state: JaafarState = {
  schemaVersion: 1,
  run: { runId: 'run-1', agentId: 'agent-1', status: 'WAITING' },
  request: {
    userMessage: 'Create a support employee',
    effort: 'medium',
    receivedAt: new Date().toISOString(),
  },
  conversation: { history: [{ role: 'user', content: 'Create a support employee' }] },
  understanding: {
    intent: 'automation_design',
    requirements: ['support role'],
    missingInputs: ['channels'],
    structured: {
      intent: 'automation_design',
      goal: 'Create a support employee',
      businessContext: '',
      trigger: { kind: 'none', event: '', schedule: '' },
      actions: [],
      entities: [],
      conditions: [],
      constraints: [],
      desiredOutcome: '',
      requirements: [{ field: 'role', value: 'support', required: true, source: 'user' }],
      assumptions: [],
      missingInputs: [
        {
          field: 'channels',
          description: 'Channels for the employee',
          question: 'Which channels should it use?',
          required: true,
        },
      ],
      confidence: 0.9,
      clarificationRequired: true,
      clarificationQuestion: 'Which channels should it use?',
    },
  },
  context: {
    skills: [],
    memoryReferences: [],
    knowledgeReferences: [],
    integrationReferences: [],
  },
  modelCalls: [],
  approval: { status: 'pending', reason: 'Employee creation is a side effect' },
  execution: { stepIndex: 0, toolCalls: [], results: [], completed: false },
  errors: [],
};

describe('Jaafar state serialization', () => {
  it('round trips a typed state', () => {
    expect(deserializeJaafarState(serializeJaafarState(state))).toEqual(state);
  });

  it('rejects unsupported checkpoint versions', () => {
    const serialized = JSON.stringify({ ...state, schemaVersion: 2 });
    expect(() => deserializeJaafarState(serialized)).toThrow();
  });

  it('rejects malformed checkpoint JSON', () => {
    expect(() => deserializeJaafarState('{"run":')).toThrow();
  });
});
