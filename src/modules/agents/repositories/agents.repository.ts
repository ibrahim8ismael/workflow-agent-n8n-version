import { Injectable } from '@nestjs/common';
import type { Agent, Prisma } from '@prisma/client';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AgentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.AgentCreateInput): Promise<Agent> {
    return this.db.agent.create({ data });
  }

  async findById(id: string, includeSkills?: boolean): Promise<Agent | null> {
    return this.db.agent.findFirst({
      where: { id, deletedAt: null },
      include: includeSkills ? { skills: { where: { deletedAt: null } } } : undefined,
    });
  }

  async findMany(params?: {
    where?: Prisma.AgentWhereInput;
    orderBy?: Prisma.AgentOrderByWithRelationInput;
    skip?: number;
    take?: number;
    includeSkills?: boolean;
  }): Promise<Agent[]> {
    return this.db.agent.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
      include: params?.includeSkills ? { skills: { where: { deletedAt: null } } } : undefined,
    });
  }

  async update(id: string, data: Prisma.AgentUpdateInput): Promise<Agent> {
    return this.db.agent.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Agent> {
    return this.db.agent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addSkill(
    agentId: string,
    skillId: string,
    config?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.agentSkill.create({
      data: {
        agent: { connect: { id: agentId } },
        skill: { connect: { id: skillId } },
        name: '',
        config: config as never,
        enabled: true,
      },
    } as never);
  }

  async removeSkill(agentId: string, skillId: string): Promise<void> {
    await this.db.agentSkill.updateMany({
      where: { agentId, skillId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async getSkills(agentId: string): Promise<
    Array<{
      id: string;
      skillId: string;
      name: string;
      enabled: boolean;
      config?: Record<string, unknown>;
    }>
  > {
    const skills = await this.db.agentSkill.findMany({
      where: { agentId, deletedAt: null },
      select: { id: true, skillId: true, name: true, enabled: true, config: true },
    });
    return skills.map((s) => ({ ...s, config: s.config as Record<string, unknown> | undefined }));
  }

  async count(where?: Prisma.AgentWhereInput): Promise<number> {
    return this.db.agent.count({ where: { ...where, deletedAt: null } });
  }
}
