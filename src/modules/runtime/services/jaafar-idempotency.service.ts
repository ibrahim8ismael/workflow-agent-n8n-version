import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma, RuntimeIdempotencyKey } from '@prisma/client';
import type { IdempotencyRecord, IdempotencyRequest } from '../interfaces/idempotency.interface';
import type { JsonValue } from '../interfaces/tool.interface';
import { IdempotencyRepository } from '../repositories/idempotency.repository';

export class IdempotencyInProgressError extends ConflictException {
  readonly code = 'IDEMPOTENCY_IN_PROGRESS' as const;
}

export class IdempotencyUnknownStatusError extends ConflictException {
  readonly code = 'UNKNOWN_SIDE_EFFECT_STATUS' as const;
}

@Injectable()
export class JaafarIdempotencyService {
  constructor(private readonly repository: IdempotencyRepository) {}

  async begin(request: IdempotencyRequest): Promise<IdempotencyRecord> {
    const key = this.keyFor(request);
    const inputHash = this.hash(request.input);
    try {
      return this.toRecord(
        await this.repository.createStarted({
          key,
          runId: request.runId,
          toolId: request.toolId,
          logicalAction: request.logicalAction,
          inputHash,
        }),
      );
    } catch (error) {
      const existing = await this.repository.findByKey(key);
      if (!existing) throw error;
      if (existing.inputHash !== inputHash) {
        throw new ConflictException('Idempotency key was reused with different input.');
      }
      if (existing.status === 'STARTED') throw new IdempotencyInProgressError();
      if (existing.status === 'UNKNOWN') throw new IdempotencyUnknownStatusError();
      return this.toRecord(existing);
    }
  }

  async complete(key: string, result: JsonValue): Promise<IdempotencyRecord> {
    return this.toRecord(await this.repository.complete(key, result as Prisma.InputJsonValue));
  }

  async fail(key: string, error: string): Promise<IdempotencyRecord> {
    return this.toRecord(await this.repository.fail(key, error));
  }

  async markUnknown(key: string, error: string): Promise<IdempotencyRecord> {
    return this.toRecord(await this.repository.markUnknown(key, error));
  }

  private keyFor(request: IdempotencyRequest): string {
    return `${request.runId}:${request.toolId}:${request.logicalAction}`;
  }

  private hash(input: JsonValue): string {
    // Key-order independent: the same logical input re-hydrated through a
    // different serialization path must hash identically, or replay detection
    // misfires with "reused with different input".
    return createHash('sha256').update(this.stableStringify(input)).digest('hex');
  }

  private stableStringify(value: JsonValue): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item as JsonValue)}`)
      .join(',')}}`;
  }

  private toRecord(record: RuntimeIdempotencyKey): IdempotencyRecord {
    return {
      key: record.key,
      runId: record.runId,
      toolId: record.toolId,
      logicalAction: record.logicalAction,
      inputHash: record.inputHash,
      status: record.status,
      // A COMPLETED record with a JSON-null result must replay as COMPLETED
      // with result null — omitting the field made the executor re-run the
      // external side effect on every subsequent call with the same key.
      ...(record.status === 'COMPLETED'
        ? { result: (record.result ?? null) as JsonValue }
        : record.result !== null
          ? { result: record.result as JsonValue }
          : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
