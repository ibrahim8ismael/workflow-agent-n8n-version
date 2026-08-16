import { Injectable } from '@nestjs/common';
import { Prisma, Skill } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class SkillsRepository {
  constructor(private readonly db: DatabaseService) {}

  private get delegate() {
    return this.db.skill;
  }

  async create(data: Prisma.SkillCreateInput): Promise<Skill> {
    return this.delegate.create({ data });
  }

  async findById(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Skill | null> {
    return this.delegate.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(scope
          ? {
              OR: [
                ...(scope.userId ? [{ userId: scope.userId }] : []),
                ...(scope.organizationId ? [{ organizationId: scope.organizationId }] : []),
                { userId: null, organizationId: null },
              ],
            }
          : {}),
      },
    });
  }

  async findBySlug(slug: string): Promise<Skill | null> {
    return this.delegate.findFirst({
      where: { slug, deletedAt: null },
    });
  }

  async findMany(params?: {
    where?: Prisma.SkillWhereInput;
    orderBy?: Prisma.SkillOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<Skill[]> {
    return this.delegate.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async update(id: string, data: Prisma.SkillUpdateInput): Promise<Skill> {
    return this.delegate.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Skill> {
    return this.delegate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async count(where?: Prisma.SkillWhereInput): Promise<number> {
    return this.delegate.count({
      where: { ...where, deletedAt: null },
    });
  }
}
