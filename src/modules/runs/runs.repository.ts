import { Injectable } from '@nestjs/common';
import { Prisma, Run } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class RunsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.RunCreateInput): Promise<Run> {
    return this.db.run.create({ data });
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
