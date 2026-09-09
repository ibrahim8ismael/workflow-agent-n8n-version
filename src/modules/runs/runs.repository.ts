import { Injectable } from '@nestjs/common';
import { Prisma, Run } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class RunsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.RunCreateInput): Promise<Run> {
    return this.db.run.create({ data });
  }

  async createAgentRun(data: Prisma.RunCreateInput, reason?: string): Promise<Run> {
    return this.db.$transaction(async (tx) => {
      const run = await tx.run.create({ data });
      await tx.agentRunTransition.create({
        data: {
          runId: run.id,
          toStatus: run.status,
          toPhase: run.currentPhase,
          reason: reason ?? 'agent run created',
        } as never,
      });
      return run;
    });
  }

  /**
   * Atomic V2 lifecycle write: version-guarded row update + journal row in
   * one transaction. Returns null on version conflict or missing row.
   */
  async transitionRun(
    id: string,
    expectedVersion: number,
    data: Prisma.RunUpdateInput,
    transition: {
      fromStatus: string | null;
      toStatus: string | null;
      fromPhase: string | null;
      toPhase: string | null;
      reason?: string | null;
    },
  ): Promise<Run | null> {
    return this.db.$transaction(async (tx) => {
      const claimed = await tx.run.updateMany({
        where: { id, version: expectedVersion, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      if (claimed.count === 0) return null;
      const updated = await tx.run.findFirst({ where: { id, deletedAt: null } });
      if (!updated) return null;
      await tx.agentRunTransition.create({
        data: {
          runId: id,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          fromPhase: transition.fromPhase as never,
          toPhase: transition.toPhase as never,
          reason: transition.reason ?? null,
        } as never,
      });
      return updated;
    });
  }

  async findById(id: string): Promise<Run | null> {
    return this.db.run.findFirst({ where: { id, deletedAt: null } });
  }

  async findMany(params?: {
    where?: Prisma.RunWhereInput;
    orderBy?: Prisma.RunOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<Run[]> {
    return this.db.run.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async findByAgent(
    agentId: string,
    options?: { limit?: number; status?: string },
  ): Promise<Run[]> {
    const where: Prisma.RunWhereInput = { agentId, deletedAt: null };
    if (options?.status) where.status = options.status as never;

    return this.db.run.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 20,
    });
  }

  async update(id: string, data: Prisma.RunUpdateInput): Promise<Run> {
    return this.db.run.update({ where: { id }, data });
  }

  /**
   * Version-guarded update for the V2 lifecycle: returns null when the row
   * moved underneath the caller (stale expectedVersion) instead of
   * silently overwriting a concurrent transition.
   */
  async updateVersioned(
    id: string,
    expectedVersion: number,
    data: Prisma.RunUpdateInput,
  ): Promise<Run | null> {
    const result = await this.db.run.updateMany({
      where: { id, version: expectedVersion, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async createTransition(data: {
    runId: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromPhase?: string | null;
    toPhase?: string | null;
    reason?: string | null;
  }): Promise<{ id: string }> {
    return this.db.agentRunTransition.create({
      data: {
        runId: data.runId,
        fromStatus: data.fromStatus ?? null,
        toStatus: data.toStatus ?? null,
        fromPhase: data.fromPhase ?? null,
        toPhase: data.toPhase ?? null,
        reason: data.reason ?? null,
      } as never,
      select: { id: true },
    });
  }

  async listTransitions(runId: string): Promise<
    Array<{
      id: string;
      runId: string;
      fromStatus: string | null;
      toStatus: string | null;
      fromPhase: string | null;
      toPhase: string | null;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    return this.db.agentRunTransition.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async claimAutomationCreation(
    id: string,
    version: number,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await this.db.run.updateMany({
      where: {
        id,
        version,
        metadata: { path: ['designStatus'], equals: 'READY_FOR_REVIEW' },
      },
      data: { metadata: metadata as never, version: { increment: 1 } },
    });
    return result.count === 1;
  }

  async softDelete(id: string): Promise<Run> {
    return this.db.run.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async count(where?: Prisma.RunWhereInput): Promise<number> {
    return this.db.run.count({ where: { ...where, deletedAt: null } });
  }
}
