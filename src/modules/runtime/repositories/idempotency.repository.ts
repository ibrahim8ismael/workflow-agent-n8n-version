import { Injectable } from '@nestjs/common';
import type { Prisma, RuntimeIdempotencyKey } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByKey(key: string): Promise<RuntimeIdempotencyKey | null> {
    return this.db.runtimeIdempotencyKey.findUnique({ where: { key } });
  }

  async createStarted(data: {
    key: string;
    runId: string;
    toolId: string;
    logicalAction: string;
    inputHash: string;
    expiresAt?: Date;
  }): Promise<RuntimeIdempotencyKey> {
    return this.db.runtimeIdempotencyKey.create({ data });
  }

  async complete(key: string, result: Prisma.InputJsonValue): Promise<RuntimeIdempotencyKey> {
    return this.db.runtimeIdempotencyKey.update({
      where: { key },
      data: { status: 'COMPLETED', result, completedAt: new Date() },
    });
  }

  async fail(key: string, error: string): Promise<RuntimeIdempotencyKey> {
    return this.db.runtimeIdempotencyKey.update({
      where: { key },
      data: { status: 'FAILED', error, completedAt: new Date() },
    });
  }

  async markUnknown(key: string, error: string): Promise<RuntimeIdempotencyKey> {
    return this.db.runtimeIdempotencyKey.update({
      where: { key },
      data: { status: 'UNKNOWN', error },
    });
  }
}
