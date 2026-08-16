import { Injectable } from '@nestjs/common';
import { RunsService } from '../../runs/runs.service';
import type { RuntimeEvent } from '../types/runtime-contract.types';
import { RuntimeObservabilityService } from './runtime-observability.service';

const MAX_EVENTS_PER_RUN = 100;

type StoredRuntimeEvent = Pick<RuntimeEvent, 'type' | 'runId' | 'occurredAt'> & {
  payload: RuntimeEvent['payload'];
};

@Injectable()
export class RuntimeEventJournalService {
  constructor(
    private readonly runs: RunsService,
    private readonly observability?: RuntimeObservabilityService,
  ) {}

  async append(event: RuntimeEvent): Promise<void> {
    this.observability?.record(event);
    const run = await this.runs.findById(event.runId);
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    const current = Array.isArray(metadata.runtimeEvents)
      ? metadata.runtimeEvents.filter((item): item is StoredRuntimeEvent =>
          this.isStoredEvent(item),
        )
      : [];
    const next = [...current, this.toStoredEvent(event)].slice(-MAX_EVENTS_PER_RUN);
    await this.runs.updateMetadata(event.runId, { runtimeEvents: next });
  }

  private toStoredEvent(event: RuntimeEvent): StoredRuntimeEvent {
    return {
      type: event.type,
      runId: event.runId,
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }

  private isStoredEvent(value: unknown): value is StoredRuntimeEvent {
    if (!value || typeof value !== 'object') return false;
    const event = value as Partial<StoredRuntimeEvent>;
    return (
      typeof event.type === 'string' &&
      typeof event.runId === 'string' &&
      typeof event.occurredAt === 'string' &&
      'payload' in event
    );
  }
}

export { MAX_EVENTS_PER_RUN };
