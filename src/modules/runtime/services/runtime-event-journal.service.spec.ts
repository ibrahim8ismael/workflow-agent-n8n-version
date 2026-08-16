import { describe, expect, it, vi } from 'vitest';
import { MAX_EVENTS_PER_RUN, RuntimeEventJournalService } from './runtime-event-journal.service';

const event = (index: number) => ({
  type: 'graph.node.completed' as const,
  runId: 'run-1',
  occurredAt: new Date(index).toISOString(),
  payload: { node: `node-${index}`, durationMs: index },
});

describe('RuntimeEventJournalService', () => {
  it('keeps only the bounded event window', async () => {
    let metadata: Record<string, unknown> = {};
    const runs = {
      findById: vi.fn().mockImplementation(() => Promise.resolve({ metadata })),
      updateMetadata: vi.fn().mockImplementation((_runId, next) => {
        metadata = { ...metadata, ...next };
        return Promise.resolve(undefined);
      }),
    };
    const service = new RuntimeEventJournalService(runs as never);

    for (let index = 0; index < MAX_EVENTS_PER_RUN + 5; index += 1) {
      await service.append(event(index));
    }

    const last = runs.updateMetadata.mock.calls.at(-1)?.[1] as { runtimeEvents: unknown[] };
    expect(last.runtimeEvents).toHaveLength(MAX_EVENTS_PER_RUN);
    expect(last.runtimeEvents[0]).toMatchObject({ occurredAt: event(5).occurredAt });
  });

  it('drops malformed existing metadata before appending', async () => {
    const runs = {
      findById: vi
        .fn()
        .mockResolvedValue({ metadata: { runtimeEvents: ['secret', null, { invalid: true }] } }),
      updateMetadata: vi.fn().mockResolvedValue(undefined),
    };
    const service = new RuntimeEventJournalService(runs as never);

    await service.append(event(1));

    expect(runs.updateMetadata).toHaveBeenCalledWith('run-1', {
      runtimeEvents: [event(1)],
    });
  });
});
