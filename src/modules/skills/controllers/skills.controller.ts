import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { Skill } from '@prisma/client';
import { type CreateSkillDto, createSkillSchema } from '../dto/create-skill.dto';
import { type UpdateSkillDto, updateSkillSchema } from '../dto/update-skill.dto';
import type { SkillsService } from '../services/skills.service';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Post()
  async create(@Body() dto: CreateSkillDto): Promise<Skill> {
    const parsed = createSkillSchema.parse(dto);
    return this.skillsService.create(parsed);
  }

  @Get()
  async findMany(@Query('skip') skip?: string, @Query('take') take?: string): Promise<Skill[]> {
    return this.skillsService.findMany({
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
