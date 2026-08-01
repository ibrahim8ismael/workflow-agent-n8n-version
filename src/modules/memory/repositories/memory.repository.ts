import { Injectable } from '@nestjs/common';
import { Memory, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class MemoryRepository {
  constructor(private readonly db: DatabaseService) {}

  private get delegate() {
    return this.db.memory;
  }

  async create(data: Prisma.MemoryCreateInput): Promise<Memory> {
    return this.delegate.create({ data });
  }

  async findById(id: string): Promise<Memory | null> {
    return this.delegate.findFirst({ where: { id, deletedAt: null } });
  }

  async findByAgentAndKey(agentId: string, key: string, type?: string): Promise<Memory | null> {
    return this.delegate.findFirst({
      where: {
        agentId,
        key,
        ...(type ? { type: type as Prisma.EnumMemoryTypeFilter['equals'] } : {}),
        deletedAt: null,
      },
    });
  }

  async findMany(params?: {
    where?: Prisma.MemoryWhereInput;
    orderBy?: Prisma.MemoryOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<Memory[]> {
    return this.delegate.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async findByAgent(
    agentId: string,
    options?: { type?: string; userId?: string; skip?: number; take?: number },
  ): Promise<Memory[]> {
    const where: Prisma.MemoryWhereInput = { agentId, deletedAt: null };
    if (options?.type) where.type = options.type as Prisma.EnumMemoryTypeFilter['equals'];
    if (options?.userId) where.userId = options.userId;

    return this.delegate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: options?.skip,
      take: options?.take,
    });
  }

  async searchByAgent(
    agentId: string,
    query: string,
    options?: { type?: string; limit?: number },
  ): Promise<Memory[]> {
    return this.delegate.findMany({
      where: {
        agentId,
        content: { contains: query, mode: 'insensitive' },
        ...(options?.type ? { type: options.type as Prisma.EnumMemoryTypeFilter['equals'] } : {}),
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 10,
    });
  }

  async update(id: string, data: Prisma.MemoryUpdateInput): Promise<Memory> {
    return this.delegate.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Memory> {
    return this.delegate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.delegate.deleteMany({
      where: {
        expiresAt: { lte: new Date() },
        deletedAt: null,
      },
    });
    return result.count;
  }
}
