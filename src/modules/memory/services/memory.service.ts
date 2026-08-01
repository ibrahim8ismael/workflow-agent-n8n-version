import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Memory, Prisma } from '@prisma/client';
import { CreateMemoryDto } from '../dto/create-memory.dto';
import { UpdateMemoryDto } from '../dto/update-memory.dto';
import { MemoryRepository } from '../repositories/memory.repository';

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value as Prisma.InputJsonValue | undefined;
}

@Injectable()
export class MemoryService {
  constructor(private readonly memoryRepository: MemoryRepository) {}

  async create(dto: CreateMemoryDto): Promise<Memory> {
    const existing = await this.memoryRepository.findByAgentAndKey(dto.agentId, dto.key, dto.type);
    if (existing) {
      throw new ConflictException(
        `Memory with key "${dto.key}" and type "${dto.type}" already exists for this agent`,
      );
    }

    return this.memoryRepository.create({
      agent: { connect: { id: dto.agentId } },
      type: dto.type as never,
      key: dto.key,
      content: dto.content,
      metadata: toJson(dto.metadata),
      ...(dto.userId ? { user: { connect: { id: dto.userId } } } : {}),
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    } as never);
  }

  async findById(id: string): Promise<Memory> {
    const memory = await this.memoryRepository.findById(id);
    if (!memory) throw new NotFoundException(`Memory with id "${id}" not found`);
    return memory;
  }

  async findByAgent(
    agentId: string,
    options?: { type?: string; userId?: string; skip?: number; take?: number },
  ): Promise<Memory[]> {
    return this.memoryRepository.findByAgent(agentId, options);
  }

  async searchByAgent(
    agentId: string,
    query: string,
    options?: { type?: string; limit?: number },
  ): Promise<Memory[]> {
    return this.memoryRepository.searchByAgent(agentId, query, options);
  }

  async update(id: string, dto: UpdateMemoryDto): Promise<Memory> {
    await this.findById(id);
    return this.memoryRepository.update(id, {
      content: dto.content,
      metadata: toJson(dto.metadata),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    } as never);
  }

  async upsert(
    agentId: string,
    key: string,
    type: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<Memory> {
    const existing = await this.memoryRepository.findByAgentAndKey(agentId, key, type);
    if (existing) {
      return this.memoryRepository.update(existing.id, {
        content,
        metadata: toJson(metadata),
      } as never);
    }
    return this.memoryRepository.create({
      agent: { connect: { id: agentId } },
      type: type as never,
      key,
      content,
      metadata: toJson(metadata),
    } as never);
  }

  async softDelete(id: string): Promise<Memory> {
    await this.findById(id);
    return this.memoryRepository.softDelete(id);
  }
}
