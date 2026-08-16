import type { RunnableConfig } from '@langchain/core/runnables';
import {
  type Checkpoint,
  type CheckpointMetadata,
  emptyCheckpoint,
  MemorySaver,
} from '@langchain/langgraph-checkpoint';
import { Injectable } from '@nestjs/common';
import type { JaafarState } from '../../modules/runtime/interfaces/jaafar-state.interface';
import {
  deserializeJaafarState,
  serializeJaafarState,
} from '../../modules/runtime/schemas/jaafar-state.schema';

export interface CheckpointScope {
  userId?: string;
  organizationId?: string;
}

@Injectable()
export class LangGraphMemoryCheckpointerService {
  private readonly saver = new MemorySaver();
  private readonly ownership = new Map<string, string>();

  async save(state: JaafarState, scope: CheckpointScope): Promise<void> {
    const threadId = this.threadId(state.run.runId);
    const scopeKey = this.scopeKey(scope);
    const currentOwner = this.ownership.get(threadId);
    if (currentOwner && currentOwner !== scopeKey) {
      throw new Error('Checkpoint scope does not match its owner');
    }

    const checkpoint: Checkpoint = {
      ...emptyCheckpoint(),
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      channel_values: { state: serializeJaafarState(state) },
      channel_versions: { state: 1 },
      versions_seen: {},
    };
    const config = this.config(threadId);
    const metadata: CheckpointMetadata<{
      runId: string;
      userId?: string;
      organizationId?: string;
      schemaVersion: number;
    }> = {
      source: 'update',
      step: 0,
      parents: {},
      runId: state.run.runId,
      userId: scope.userId,
      organizationId: scope.organizationId,
      schemaVersion: state.schemaVersion,
    };
    await this.saver.put(config, checkpoint, metadata);
    this.ownership.set(threadId, scopeKey);
  }

  async load(runId: string, scope: CheckpointScope): Promise<JaafarState | undefined> {
    const threadId = this.threadId(runId);
    const owner = this.ownership.get(threadId);
    if (!owner) return undefined;
    if (owner !== this.scopeKey(scope)) {
      throw new Error('Checkpoint scope does not match its owner');
    }

    const checkpoint = await this.saver.get(this.config(threadId));
    if (!checkpoint) return undefined;
    const serialized = checkpoint.channel_values.state;
    if (typeof serialized !== 'string') {
      throw new Error('Checkpoint does not contain Jaafar state');
    }
    return deserializeJaafarState(serialized);
  }

  async delete(runId: string, scope: CheckpointScope): Promise<void> {
    const threadId = this.threadId(runId);
    const owner = this.ownership.get(threadId);
    if (!owner) return;
    if (owner !== this.scopeKey(scope)) {
      throw new Error('Checkpoint scope does not match its owner');
    }
    await this.saver.deleteThread(threadId);
    this.ownership.delete(threadId);
  }

  private config(threadId: string): RunnableConfig {
    return { configurable: { thread_id: threadId } };
  }

  private threadId(runId: string): string {
    return `jaafar:${runId}`;
  }

  private scopeKey(scope: CheckpointScope): string {
    return `${scope.userId ?? ''}:${scope.organizationId ?? ''}`;
  }
}
