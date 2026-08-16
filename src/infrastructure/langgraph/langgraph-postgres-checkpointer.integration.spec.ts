import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { JaafarState } from '../../modules/runtime/interfaces/jaafar-state.interface';
import { LangGraphPostgresCheckpointerService } from './langgraph-postgres-checkpointer.service';

const hasDatabase = Boolean(process.env.DATABASE_URL);

const state = (runId: string): JaafarState => ({
  schemaVersion: 1,
  run: { runId, agentId: 'agent-1', userId: 'user-1', organizationId: 'org-1', status: 'WAITING' },
  request: {
    userMessage: 'Approve this action',
    effort: 'medium',
    receivedAt: new Date().toISOString(),
  },
  conversation: { history: [] },
  understanding: { requirements: [], missingInputs: [] },
  context: { skills: [], memoryReferences: [], knowledgeReferences: [], integrationReferences: [] },
  modelCalls: [],
  approval: { status: 'pending', reason: 'Side effect requires approval' },
  execution: { stepIndex: 0, toolCalls: [], results: [], completed: false },
  errors: [],
});

describe.skipIf(!hasDatabase)('LangGraphPostgresCheckpointerService integration', () => {
  it('loads a waiting checkpoint from a fresh service instance and isolates scope', async ({
    skip,
  }) => {
    const config = {
      get: (key: string) => (key === 'database.url' ? process.env.DATABASE_URL : undefined),
    } as unknown as ConfigService;
    const first = new LangGraphPostgresCheckpointerService(config);
    const second = new LangGraphPostgresCheckpointerService(config);
    const runId = `restart-${crypto.randomUUID()}`;
    const saved = state(runId);

    try {
      await first.setup();
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      if (
        failure.code === 'ECONNREFUSED' ||
        (failure.code === 'CHECKPOINT_FAILURE' && failure.message?.includes('ECONNREFUSED'))
      ) {
        skip();
        return;
      }
      throw error;
    }
    await first.save(saved, { userId: 'user-1', organizationId: 'org-1' });

    const restored = await second.load(runId, { userId: 'user-1', organizationId: 'org-1' });
    const wrongUser = await second.load(runId, { userId: 'user-2', organizationId: 'org-1' });
    const wrongOrganization = await second.load(runId, {
      userId: 'user-1',
      organizationId: 'org-2',
    });

    expect(restored).toEqual(saved);
    expect(wrongUser).toBeUndefined();
    expect(wrongOrganization).toBeUndefined();

    await second.delete(runId, { userId: 'user-1', organizationId: 'org-1' });
    await first.onModuleDestroy();
    await second.onModuleDestroy();
  });
});
