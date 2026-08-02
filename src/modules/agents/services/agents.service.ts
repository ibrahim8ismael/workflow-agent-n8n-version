import { Injectable, NotFoundException } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { AGENT_STATUS } from '../constants/agent.constants';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
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
      status: (dto.status ?? 'DRAFT') as never,
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
    } as never);
  }

  async findById(id: string, includeSkills?: boolean): Promise<Agent> {
    const agent = await this.agentsRepository.findById(id, includeSkills);
    if (!agent) throw new NotFoundException(`Agent with id "${id}" not found`);
    return agent;
  }

  async findMany(params?: {
    organizationId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<Agent[]> {
    const where: Record<string, unknown> = {};
    if (params?.organizationId) where.organizationId = params.organizationId;
    if (params?.status) where.status = params.status;

    return this.agentsRepository.findMany({
      where: where as PrismaType,
      orderBy: { createdAt: 'desc' },
      skip: params?.skip,
      take: params?.take,
    });
  }

  async update(id: string, dto: UpdateAgentDto): Promise<Agent> {
    await this.findById(id);
    return this.agentsRepository.update(id, dto as never);
  }

  async softDelete(id: string): Promise<Agent> {
    await this.findById(id);
    return this.agentsRepository.softDelete(id);
  }

  async publish(id: string): Promise<Agent> {
    await this.findById(id);
    return this.agentsRepository.update(id, { status: AGENT_STATUS.PUBLISHED });
  }

  async archive(id: string): Promise<Agent> {
    await this.findById(id);
    return this.agentsRepository.update(id, { status: AGENT_STATUS.ARCHIVED });
  }

  async addSkill(
    agentId: string,
    skillId: string,
    config?: Record<string, unknown>,
  ): Promise<void> {
    await this.findById(agentId);
    await this.agentsRepository.addSkill(agentId, skillId, config);
  }

  async removeSkill(agentId: string, skillId: string): Promise<void> {
    await this.findById(agentId);
    await this.agentsRepository.removeSkill(agentId, skillId);
  }

  async getSkills(agentId: string) {
    await this.findById(agentId);
    return this.agentsRepository.getSkills(agentId);
  }
}

type PrismaType = Record<string, unknown>;
