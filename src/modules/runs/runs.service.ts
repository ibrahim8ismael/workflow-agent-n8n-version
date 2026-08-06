import { Injectable, NotFoundException } from '@nestjs/common';
import { Run } from '@prisma/client';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsRepository } from './runs.repository';

@Injectable()
export class RunsService {
  constructor(private readonly runsRepository: RunsRepository) {}

  async create(dto: CreateRunDto): Promise<Run> {
    return this.runsRepository.create({
      agent: { connect: { id: dto.agentId } },
      ...(dto.conversationId ? { conversation: { connect: { id: dto.conversationId } } } : {}),
      userId: dto.userId,
      organizationId: dto.organizationId,
      metadata: dto.metadata as never,
      status: 'CREATED',
    } as never);
  }

  async findById(id: string): Promise<Run> {
    const run = await this.runsRepository.findById(id);
    if (!run) throw new NotFoundException(`Run with id "${id}" not found`);
    return run;
  }

  async findByAgent(
    agentId: string,
    options?: { limit?: number; status?: string },
  ): Promise<Run[]> {
    return this.runsRepository.findByAgent(agentId, options);
  }

  async transitionStatus(id: string, newStatus: string): Promise<Run> {
    const run = await this.findById(id);
    this.validateTransition(run.status, newStatus);
    return this.runsRepository.update(id, {
      status: newStatus,
      ...(newStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
    } as never);
  }

  async complete(id: string, result?: string): Promise<Run> {
    await this.findById(id);
    return this.runsRepository.update(id, {
      status: 'COMPLETED',
      result,
      completedAt: new Date(),
    } as never);
  }

  async fail(id: string, error: string): Promise<Run> {
    await this.findById(id);
    return this.runsRepository.update(id, {
      status: 'FAILED',
      error,
      completedAt: new Date(),
    } as never);
  }

  async cancel(id: string): Promise<Run> {
    await this.findById(id);
    return this.runsRepository.update(id, {
      status: 'CANCELLED',
      completedAt: new Date(),
    } as never);
  }

  async updateUsage(
    id: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): Promise<Run> {
    await this.findById(id);
    return this.runsRepository.update(id, {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    } as never);
  }

  async savePlan(id: string, plan: Record<string, unknown>): Promise<Run> {
    await this.findById(id);
    return this.runsRepository.update(id, { plan: plan as never });
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<Run> {
    const run = await this.findById(id);
    const currentMetadata = (run.metadata as Record<string, unknown> | null) ?? {};
    const execution = metadata.execution as
      | { estimatedCost?: number; durationMs?: number }
      | undefined;
    return this.runsRepository.update(id, {
      metadata: { ...currentMetadata, ...metadata } as never,
      ...(typeof execution?.estimatedCost === 'number'
        ? { estimatedCost: execution.estimatedCost }
        : {}),
      ...(typeof execution?.durationMs === 'number' ? { durationMs: execution.durationMs } : {}),
    });
  }

  private validateTransition(current: string, next: string): void {
    const validTransitions: Record<string, string[]> = {
      CREATED: ['PREPARING', 'CANCELLED'],
      PREPARING: ['PLANNING', 'FAILED', 'CANCELLED'],
      PLANNING: ['WAITING', 'FAILED', 'CANCELLED'],
      EXECUTING: ['WAITING', 'GENERATING', 'FAILED', 'CANCELLED'],
      WAITING: ['EXECUTING', 'TIMEOUT', 'FAILED', 'CANCELLED'],
      GENERATING: ['PERSISTING', 'FAILED', 'CANCELLED'],
      PERSISTING: ['COMPLETED', 'FAILED', 'CANCELLED'],
    };

    const allowed = validTransitions[current];
    if (!allowed?.includes(next)) {
      throw new Error(`Invalid state transition: ${current} → ${next}`);
    }
  }
}
