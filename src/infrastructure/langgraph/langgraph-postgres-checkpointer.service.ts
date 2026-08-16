import type { RunnableConfig } from '@langchain/core/runnables';
import {
  type Checkpoint,
  type CheckpointMetadata,
  emptyCheckpoint,
} from '@langchain/langgraph-checkpoint';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JaafarState } from '../../modules/runtime/interfaces/jaafar-state.interface';
import {
  deserializeJaafarState,
  serializeJaafarState,
} from '../../modules/runtime/schemas/jaafar-state.schema';
import type { CheckpointScope } from './langgraph-memory-checkpointer.service';

export class LangGraphCheckpointError extends Error {
  constructor(
    readonly code: 'CHECKPOINT_FAILURE' | 'CHECKPOINT_MISSING' | 'CHECKPOINT_INCOMPATIBLE',
    message: string,
  ) {
    super(message);
    this.name = LangGraphCheckpointError.name;
  }
}

@Injectable()
export class LangGraphPostgresCheckpointerService implements OnModuleDestroy {
  private readonly logger = new Logger(LangGraphPostgresCheckpointerService.name);
  private saver?: PostgresSaver;

  constructor(private readonly config: ConfigService) {}

  getCheckpointer(): PostgresSaver {
    if (this.saver) return this.saver;

    const connectionString =
      this.config.get<string>('database.url') ?? this.config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for the PostgreSQL LangGraph checkpointer');
    }
    this.saver = PostgresSaver.fromConnString(connectionString, {
      schema: 'langgraph_checkpoints',
    });
    return this.saver;
  }

  async setup(): Promise<void> {
    try {
      await this.getCheckpointer().setup();
    } catch (error) {
      this.logFailure('setup', error);
      throw new LangGraphCheckpointError('CHECKPOINT_FAILURE', this.safeMessage(error));
    }
  }

  async save(state: JaafarState, scope: CheckpointScope): Promise<void> {
    const checkpoint: Checkpoint = {
      ...emptyCheckpoint(),
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      channel_values: { state: serializeJaafarState(state) },
      channel_versions: { state: 1 },
      versions_seen: {},
    };
    const threadId = this.threadId(state.run.runId, scope);
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
    try {
      await this.getCheckpointer().put(this.configFor(threadId), checkpoint, metadata, {
        state: 1,
      });
    } catch (error) {
      this.logFailure('save', error);
      throw new LangGraphCheckpointError('CHECKPOINT_FAILURE', this.safeMessage(error));
    }
  }

  async load(runId: string, scope: CheckpointScope): Promise<JaafarState | undefined> {
    let checkpoint: Checkpoint | undefined;
    try {
      checkpoint = await this.getCheckpointer().get(this.configFor(this.threadId(runId, scope)));
    } catch (error) {
      this.logFailure('load', error);
      throw new LangGraphCheckpointError('CHECKPOINT_FAILURE', this.safeMessage(error));
    }
    if (!checkpoint) return undefined;
    const serialized = checkpoint.channel_values.state;
    if (typeof serialized !== 'string') {
      throw new LangGraphCheckpointError(
        'CHECKPOINT_INCOMPATIBLE',
        'Checkpoint does not contain compatible Jaafar state',
      );
    }
    try {
      return deserializeJaafarState(serialized);
    } catch {
      throw new LangGraphCheckpointError(
        'CHECKPOINT_INCOMPATIBLE',
        'Checkpoint contains an unsupported Jaafar state version',
      );
    }
  }

  async delete(runId: string, scope: CheckpointScope): Promise<void> {
    try {
      await this.getCheckpointer().deleteThread(this.threadId(runId, scope));
    } catch (error) {
      this.logFailure('delete', error);
      throw new LangGraphCheckpointError('CHECKPOINT_FAILURE', this.safeMessage(error));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.saver?.end();
  }

  private configFor(threadId: string): RunnableConfig {
    return { configurable: { thread_id: threadId } };
  }

  private threadId(runId: string, scope: CheckpointScope): string {
    return `jaafar:${scope.organizationId ?? 'personal'}:${scope.userId ?? 'anonymous'}:${runId}`;
  }

  private safeMessage(error: unknown): string {
    if (error instanceof AggregateError) {
      const messages = error.errors
        .map((entry) => (entry instanceof Error ? entry.message : String(entry)))
        .filter(Boolean);
      if (messages.length) return messages.join('; ');
    }
    return error instanceof Error ? error.message : 'LangGraph checkpoint operation failed';
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.warn({
      event: 'checkpoint.failed',
      operation,
      error: this.safeMessage(error),
    });
  }
}
