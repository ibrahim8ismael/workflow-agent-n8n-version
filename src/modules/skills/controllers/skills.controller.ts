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
import { Skill } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { type CreateSkillDto, createSkillSchema } from '../dto/create-skill.dto';
import { type UpdateSkillDto, updateSkillSchema } from '../dto/update-skill.dto';
import { SkillsService } from '../services/skills.service';

@Controller('skills')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Post()
  async create(@Body() dto: CreateSkillDto, @CurrentUser() user: SkillUser): Promise<Skill> {
    const parsed = createSkillSchema.parse(dto);
    return this.skillsService.create({
      ...parsed,
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    });
  }

  @Get()
  async findMany(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @CurrentUser() user?: SkillUser,
  ): Promise<Skill[]> {
    return this.skillsService.findMany({
      where: user
        ? {
            OR: [
              { userId: user.id },
              ...(user.activeContext === 'organization' && user.organizationId
                ? [{ organizationId: user.organizationId }]
                : []),
            ],
          }
        : undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Skill> {
    return this.skillsService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSkillDto): Promise<Skill> {
    const parsed = updateSkillSchema.parse(dto);
    return this.skillsService.update(id, parsed);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<Skill> {
    return this.skillsService.softDelete(id);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string): Promise<Skill> {
    return this.skillsService.publish(id);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<Skill> {
    return this.skillsService.archive(id);
  }
}

type SkillUser = { id: string; activeContext?: string; organizationId?: string };
