import { Injectable, NotFoundException } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { AGENT_STATUS } from '../constants/agent.constants';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
import type { AssignedAgentSkill } from '../interfaces/agent.interface';
import { AgentsRepository } from '../repositories/agents.repository';

@Injectable()
export class AgentsService {
  constructor(private readonly agentsRepository: AgentsRepository) {}

  async create(dto: CreateAgentDto): Promise<Agent> {
    return this.agentsRepository.create({
      name: dto.name,
      description: dto.description,
      instructions: dto.instructions,
      personality: dto.personality,
      model: dto.model,
      // Creation is always a draft transition; publication and activation are separate actions.
      status: 'DRAFT' as never,
      ...(dto.userId ? { user: { connect: { id: dto.userId } } } : {}),
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
    } as never);
  }

  async findById(
    id: string,
    includeSkills?: boolean,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Agent> {
    const agent = await this.agentsRepository.findById(id, includeSkills, scope);
    if (!agent) throw new NotFoundException(`Agent with id "${id}" not found`);
    return agent;
  }

  async getJaafar(): Promise<Agent> {
    let agent = await this.agentsRepository.findPlatformAgent('Jaafar');
    if (!agent) {
      agent = await this.agentsRepository.findById('00000000-0000-4000-8000-000000000001');
    }
    if (!agent) {
      agent = await this.agentsRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Jaafar',
        description: 'The Woops AI guide who designs digital employees with business owners.',
        instructions:
          'You are Jaafar, the AI guide inside Woops. Help business owners design digital employees. Never claim an employee was created without backend confirmation.',
        status: 'PUBLISHED' as never,
      } as never);
    }
    return agent;
  }

  async findPlatformAgent(slug: string): Promise<Agent> {
    if (slug.toLowerCase() === 'jaafar') {
      return this.getJaafar();
    }
    const agent = await this.agentsRepository.findPlatformAgent(slug);
    if (!agent) {
      throw new NotFoundException(`Platform agent "${slug}" not found`);
    }
    return agent;
  }

  async findMany(params?: {
    userId?: string;
    organizationId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<Agent[]> {
    const where: Record<string, unknown> = {};
    if (params?.userId || params?.organizationId) {
      where.OR = [
        ...(params.userId ? [{ userId: params.userId }] : []),
        ...(params.organizationId ? [{ organizationId: params.organizationId }] : []),
      ];
    }
    if (params?.status) where.status = params.status;

    return this.agentsRepository.findMany({
      where: where as PrismaType,
      orderBy: { createdAt: 'desc' },
      skip: params?.skip,
      take: params?.take,
    });
  }

  async update(
    id: string,
    dto: UpdateAgentDto,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Agent> {
    await this.findById(id, false, scope);
    return this.agentsRepository.update(id, dto as never);
  }

  async softDelete(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Agent> {
    await this.findById(id, false, scope);
    return this.agentsRepository.softDelete(id);
  }

  async publish(id: string, scope?: { userId?: string; organizationId?: string }): Promise<Agent> {
    await this.findById(id, false, scope);
    return this.agentsRepository.update(id, { status: AGENT_STATUS.PUBLISHED });
  }

  async archive(id: string, scope?: { userId?: string; organizationId?: string }): Promise<Agent> {
    await this.findById(id, false, scope);
    return this.agentsRepository.update(id, { status: AGENT_STATUS.ARCHIVED });
  }

  async addSkill(
    agentId: string,
    skillId: string,
    config?: Record<string, unknown>,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<void> {
    await this.findById(agentId, false, scope);
    await this.agentsRepository.addSkill(agentId, skillId, config);
  }

  async removeSkill(
    agentId: string,
    skillId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<void> {
    await this.findById(agentId, false, scope);
    await this.agentsRepository.removeSkill(agentId, skillId);
  }

  async getSkills(agentId: string, scope?: { userId?: string; organizationId?: string }) {
    await this.findById(agentId, false, scope);
    return this.agentsRepository.getSkills(agentId);
  }

  async getAssignedSkills(
    agentId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<AssignedAgentSkill[]> {
    await this.findById(agentId, false, scope);
    return this.agentsRepository.getAssignedSkills(agentId, scope);
  }
}

type PrismaType = Record<string, unknown>;
