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

  @Get('platform/jaafar')
  async getJaafar(): Promise<Agent> {
    return this.agentsService.getJaafar();
  }

  @Get('platform/:slug')
  async getPlatformAgent(@Param('slug') slug: string): Promise<Agent> {
    return this.agentsService.findPlatformAgent(slug);
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: AgentUser): Promise<Agent> {
    return this.agentsService.findById(id, true, this.scopeFor(user));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() user: AgentUser,
  ): Promise<Agent> {
    const parsed = updateAgentSchema.parse(dto);
    return this.agentsService.update(id, parsed, this.scopeFor(user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AgentUser): Promise<Agent> {
    return this.agentsService.softDelete(id, this.scopeFor(user));
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: AgentUser): Promise<Agent> {
    return this.agentsService.publish(id, this.scopeFor(user));
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string, @CurrentUser() user: AgentUser): Promise<Agent> {
    return this.agentsService.archive(id, this.scopeFor(user));
  }

  @Post(':id/skills/:skillId')
  async addSkill(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @CurrentUser() user: AgentUser,
  ): Promise<void> {
    return this.agentsService.addSkill(id, skillId, undefined, this.scopeFor(user));
  }

  @Delete(':id/skills/:skillId')
  async removeSkill(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @CurrentUser() user: AgentUser,
  ): Promise<void> {
    return this.agentsService.removeSkill(id, skillId, this.scopeFor(user));
  }

  @Get(':id/skills')
  async getSkills(@Param('id') id: string, @CurrentUser() user: AgentUser) {
    return this.agentsService.getSkills(id, this.scopeFor(user));
  }

  private scopeFor(user: AgentUser): { userId: string; organizationId?: string } {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }
}

type AgentUser = { id: string; activeContext?: string; organizationId?: string };
