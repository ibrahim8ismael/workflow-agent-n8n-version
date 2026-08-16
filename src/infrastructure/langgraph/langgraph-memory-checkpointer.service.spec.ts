import { describe, expect, it } from 'vitest';
import type { JaafarState } from '../../modules/runtime/interfaces/jaafar-state.interface';
import { LangGraphMemoryCheckpointerService } from './langgraph-memory-checkpointer.service';

const state: JaafarState = {
  schemaVersion: 1,
  run: {
    runId: 'run-1',
    agentId: 'agent-1',
    userId: 'user-1',
    organizationId: 'org-1',
    status: 'WAITING',
  },
  request: {
    userMessage: 'Create an employee',
    effort: 'medium',
    receivedAt: new Date().toISOString(),
  },
  conversation: { history: [] },
  understanding: { requirements: [], missingInputs: [] },
  context: {
    skills: [],
    memoryReferences: [],
    knowledgeReferences: [],
    integrationReferences: [],
  },
  modelCalls: [],
  approval: { status: 'pending' },
  execution: { stepIndex: 0, toolCalls: [], results: [], completed: false },
  errors: [],
};

describe('LangGraphMemoryCheckpointerService', () => {
  it('saves and loads Jaafar state by run and tenant scope', async () => {
    const service = new LangGraphMemoryCheckpointerService();
    const scope = { userId: 'user-1', organizationId: 'org-1' };

    await service.save(state, scope);

    await expect(service.load('run-1', scope)).resolves.toEqual(state);
  });

  it('rejects loading a checkpoint from another tenant scope', async () => {
    const service = new LangGraphMemoryCheckpointerService();
    await service.save(state, { userId: 'user-1', organizationId: 'org-1' });

    await expect(
      service.load('run-1', { userId: 'user-2', organizationId: 'org-1' }),
    ).rejects.toThrow('Checkpoint scope does not match its owner');
  });

  it('deletes a checkpoint only from its owning scope', async () => {
    const service = new LangGraphMemoryCheckpointerService();
    const scope = { userId: 'user-1', organizationId: 'org-1' };
    await service.save(state, scope);

    await service.delete('run-1', scope);

    await expect(service.load('run-1', scope)).resolves.toBeUndefined();
  });
});
