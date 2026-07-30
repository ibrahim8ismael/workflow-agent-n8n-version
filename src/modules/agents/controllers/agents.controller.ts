import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Agent } from '@prisma/client';
import { type CreateAgentDto, createAgentSchema } from '../dto/create-agent.dto';
import { type UpdateAgentDto, updateAgentSchema } from '../dto/update-agent.dto';
import type { AgentsService } from '../services/agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  async create(@Body() dto: CreateAgentDto): Promise<Agent> {
    const parsed = createAgentSchema.parse(dto);
    return this.agentsService.create(parsed);
  }

  @Get()
  async findMany(
    @Query('organizationId') organizationId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<Agent[]> {
    return this.agentsService.findMany({
      organizationId,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Agent> {
    return this.agentsService.findById(id, true);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateAgentDto): Promise<Agent> {
    const parsed = updateAgentSchema.parse(dto);
    return this.agentsService.update(id, parsed);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<Agent> {
    return this.agentsService.softDelete(id);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string): Promise<Agent> {
    return this.agentsService.publish(id);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<Agent> {
    return this.agentsService.archive(id);
  }

  @Post(':id/skills/:skillId')
  async addSkill(@Param('id') id: string, @Param('skillId') skillId: string): Promise<void> {
    return this.agentsService.addSkill(id, skillId);
  }

  @Delete(':id/skills/:skillId')
  async removeSkill(@Param('id') id: string, @Param('skillId') skillId: string): Promise<void> {
    return this.agentsService.removeSkill(id, skillId);
  }

  @Get(':id/skills')
  async getSkills(@Param('id') id: string) {
    return this.agentsService.getSkills(id);
  }
}
