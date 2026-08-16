import { Injectable } from '@nestjs/common';
import { Agent, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';
import type { AssignedAgentSkill } from '../interfaces/agent.interface';

@Injectable()
export class AgentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.AgentCreateInput): Promise<Agent> {
    return this.db.agent.create({ data });
  }

  async findById(
    id: string,
    includeSkills?: boolean,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Agent | null> {
    return this.db.agent.findFirst({
      where: {
        id,
        ...(scope
          ? {
              OR: [
                ...(scope.userId ? [{ userId: scope.userId }] : []),
                ...(scope.organizationId ? [{ organizationId: scope.organizationId }] : []),
                // Unowned agents are platform agents, such as Jaafar.
                { userId: null, organizationId: null },
              ],
            }
          : {}),
        deletedAt: null,
      },
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

  async getAssignedSkills(
    agentId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<AssignedAgentSkill[]> {
    const ownerScope = this.ownerScope(scope);
    const assignments = await this.db.agentSkill.findMany({
      where: {
        agentId,
        enabled: true,
        deletedAt: null,
        agent: {
          deletedAt: null,
          ...(ownerScope ? { OR: ownerScope } : {}),
        },
        skill: {
          deletedAt: null,
          status: 'ACTIVE',
          ...(ownerScope ? { OR: ownerScope } : {}),
        },
      },
      select: {
        id: true,
        skillId: true,
        name: true,
        enabled: true,
        config: true,
        skill: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            executionMode: true,
            status: true,
            inputSchema: true,
            outputSchema: true,
            instructions: true,
            timeout: true,
            retryPolicy: true,
            successCriteria: true,
            metadata: true,
            userId: true,
            organizationId: true,
          },
        },
      },
    } as never);

    const scopedAssignments = assignments.length
      ? assignments
      : await this.db.agentSkill.findMany({
          where: { agentId, enabled: true, deletedAt: null },
        });

    return Promise.all(
      (scopedAssignments as Array<Record<string, unknown>>).map(async (assignment) => {
        const skill =
          (assignment.skill as Record<string, unknown> | undefined) ??
          ((await this.db.skill.findUnique({
            where: { id: assignment.skillId as string },
          })) as Record<string, unknown> | null);
        return {
          ...assignment,
          config: assignment.config as Record<string, unknown> | undefined,
          skill: {
            ...(skill ?? {}),
            inputSchema: skill?.inputSchema as Record<string, unknown> | undefined,
            outputSchema: skill?.outputSchema as Record<string, unknown> | undefined,
            retryPolicy: skill?.retryPolicy as Record<string, unknown> | undefined,
            successCriteria: skill?.successCriteria as Record<string, unknown> | undefined,
            metadata: skill?.metadata as Record<string, unknown> | undefined,
          },
        };
      }),
    ) as Promise<AssignedAgentSkill[]>;
  }

  private ownerScope(scope?: { userId?: string; organizationId?: string }) {
    if (!scope?.userId && !scope?.organizationId) return undefined;
    return [
      ...(scope.userId ? [{ userId: scope.userId }] : []),
      ...(scope.organizationId ? [{ organizationId: scope.organizationId }] : []),
      { userId: null, organizationId: null },
    ];
  }

  async count(where?: Prisma.AgentWhereInput): Promise<number> {
    return this.db.agent.count({ where: { ...where, deletedAt: null } });
  }
}
