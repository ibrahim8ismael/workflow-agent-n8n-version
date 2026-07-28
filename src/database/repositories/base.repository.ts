import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { generateId } from '../../common/utils/uuid';

@Injectable()
export abstract class BaseRepository<T, CreateDto, UpdateDto> {
  constructor(protected readonly db: DatabaseService) {}

  protected abstract get modelDelegate(): {
    create: (args: { data: Record<string, unknown> }) => Promise<T>;
    findUnique: (args: { where: Record<string, unknown> }) => Promise<T | null>;
    findFirst: (args: { where: Record<string, unknown> }) => Promise<T | null>;
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, string>;
      skip?: number;
      take?: number;
    }) => Promise<T[]>;
    update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<T>;
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };

  async create(data: CreateDto): Promise<T> {
    return this.modelDelegate.create({
      data: { ...(data as Record<string, unknown>), id: generateId() },
    });
  }

  async findById(id: string): Promise<T | null> {
    return this.modelDelegate.findUnique({
      where: { id, deletedAt: null } as Record<string, unknown>,
    });
  }

  async findMany(params?: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, string>;
    skip?: number;
    take?: number;
  }): Promise<T[]> {
    return this.modelDelegate.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async update(id: string, data: UpdateDto): Promise<T> {
    return this.modelDelegate.update({
      where: { id } as Record<string, unknown>,
      data: data as Record<string, unknown>,
    });
  }

  async softDelete(id: string): Promise<T> {
    return this.modelDelegate.update({
      where: { id } as Record<string, unknown>,
      data: { deletedAt: new Date() } as Record<string, unknown>,
    });
  }

  async count(where?: Record<string, unknown>): Promise<number> {
    return this.modelDelegate.count({
      where: { ...where, deletedAt: null },
    });
  }
}
