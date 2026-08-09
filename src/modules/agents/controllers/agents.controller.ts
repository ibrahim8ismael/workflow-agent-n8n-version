import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Agent } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { type CreateAgentDto, createAgentSchema } from '../dto/create-agent.dto';
import { type UpdateAgentDto, updateAgentSchema } from '../dto/update-agent.dto';
import { AgentsService } from '../services/agents.service';

@Controller('agents')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  async create(@Body() dto: CreateAgentDto, @CurrentUser() user: AgentUser): Promise<Agent> {
    const parsed = createAgentSchema.parse(dto);
    return this.agentsService.create({
      ...parsed,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    });
  }

  @Get()
  async findMany(
    @Query('organizationId') _organizationId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @CurrentUser() user?: AgentUser,
  ): Promise<Agent[]> {
    return this.agentsService.findMany({
      userId: user?.id,
      organizationId: user?.activeContext === 'organization' ? user.organizationId : undefined,
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: AgentUser): Promise<Agent> {
    return this.agentsService.findById(id, true, {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    });
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

type AgentUser = { id: string; activeContext?: string; organizationId?: string };
