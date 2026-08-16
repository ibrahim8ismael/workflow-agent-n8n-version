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
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private toRecord(record: RuntimeIdempotencyKey): IdempotencyRecord {
    return {
      key: record.key,
      runId: record.runId,
      toolId: record.toolId,
      logicalAction: record.logicalAction,
      inputHash: record.inputHash,
      status: record.status,
      ...(record.result === null ? {} : { result: record.result as JsonValue }),
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
