import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Skill } from '@prisma/client';
import { SKILL_STATUS } from '../constants/skill.constants';
import type { CreateSkillDto } from '../dto/create-skill.dto';
import type { UpdateSkillDto } from '../dto/update-skill.dto';
import type { SkillsRepository } from '../repositories/skills.repository';

@Injectable()
export class SkillsService {
  constructor(private readonly skillsRepository: SkillsRepository) {}

  async create(dto: CreateSkillDto): Promise<Skill> {
    const existing = await this.skillsRepository.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictException(`Skill with slug "${dto.slug}" already exists`);
    }
    return this.skillsRepository.create(dto as Record<string, unknown> as never);
  }

  async findById(id: string): Promise<Skill> {
    const skill = await this.skillsRepository.findById(id);
    if (!skill) {
      throw new NotFoundException(`Skill with id "${id}" not found`);
    }
    return skill;
  }

  async findBySlug(slug: string): Promise<Skill | null> {
    return this.skillsRepository.findBySlug(slug);
  }

  async findMany(params?: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, string>;
    skip?: number;
    take?: number;
  }): Promise<Skill[]> {
    return this.skillsRepository.findMany(params);
  }

  async update(id: string, dto: UpdateSkillDto): Promise<Skill> {
    await this.findById(id);
    return this.skillsRepository.update(id, dto as Record<string, unknown> as never);
  }

  async softDelete(id: string): Promise<Skill> {
    await this.findById(id);
    return this.skillsRepository.softDelete(id);
  }

  async publish(id: string): Promise<Skill> {
    await this.findById(id);
    return this.skillsRepository.update(id, { status: SKILL_STATUS.PUBLISHED } as never);
  }

  async archive(id: string): Promise<Skill> {
    await this.findById(id);
    return this.skillsRepository.update(id, { status: SKILL_STATUS.ARCHIVED } as never);
  }
}
