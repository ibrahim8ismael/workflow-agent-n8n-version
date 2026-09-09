import { Injectable, NotFoundException } from '@nestjs/common';
import { Run } from '@prisma/client';
import { validateStatusTransition, validateTerminalWrite } from './agent-run-phase';
import { CreateRunDto } from './dto/create-run.dto';
import { RunsRepository } from './runs.repository';

@Injectable()
export class RunsService {
  constructor(private readonly runsRepository: RunsRepository) {}

  private static readonly PENDING_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

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

  async findByIdOrConversation(id: string): Promise<Run> {
    const run = await this.runsRepository.findById(id);
    if (run) return run;

    const conversationRuns = await this.runsRepository.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (conversationRuns.length > 0) {
      return conversationRuns[0];
    }

    throw new NotFoundException(`Run with id "${id}" not found`);
  }

  /**
   * Latest still-WAITING run in a conversation (excluding one id) — used to
   * carry an unanswered follow-up question into the next turn's
   * classification. Pending context older than 24h is stale and is ignored
   * so an old unanswered question never pollutes new conversations.
   * Returns null when nothing is pending.
   */
  async findLatestWaitingInConversation(
    conversationId: string,
    excludeRunId?: string,
  ): Promise<Run | null> {
    const cutoff = new Date(Date.now() - RunsService.PENDING_CONTEXT_TTL_MS);
    const waiting = await this.runsRepository.findMany({
      where: {
        conversationId,
        status: 'WAITING' as never,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return waiting.find((run) => run.id !== excludeRunId) ?? null;
  }

  async findByAgent(
    agentId: string,
    options?: { limit?: number; status?: string },
  ): Promise<Run[]> {
    return this.runsRepository.findByAgent(agentId, options);
  }

  /** Bounded window listing for aggregations (metrics, traces). */
  async list(params?: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  }): Promise<Run[]> {
    return this.runsRepository.findMany({
      where: params?.where as never,
      orderBy: params?.orderBy as never,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async transitionStatus(id: string, newStatus: string, reason?: string): Promise<Run> {
    const run = await this.findById(id);
    this.validateTransition(run.status, newStatus);
    const updated = await this.runsRepository.update(id, {
      status: newStatus,
      ...(newStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
    } as never);
    await this.recordTransition({
      runId: id,
      fromStatus: run.status,
      toStatus: newStatus,
      fromPhase: (run as { currentPhase?: string | null }).currentPhase ?? null,
      toPhase: (updated as { currentPhase?: string | null }).currentPhase ?? null,
      reason,
    });
    return updated;
  }

  async complete(id: string, result?: string, reason?: string): Promise<Run> {
    const run = await this.findById(id);
    validateTerminalWrite(run.status, 'COMPLETED');
    const updated = await this.runsRepository.update(id, {
      status: 'COMPLETED',
      result,
      completedAt: new Date(),
    } as never);
    await this.recordTransition({
      runId: id,
      fromStatus: run.status,
      toStatus: 'COMPLETED',
      fromPhase: (run as { currentPhase?: string | null }).currentPhase ?? null,
      toPhase: (updated as { currentPhase?: string | null }).currentPhase ?? null,
      reason: reason ?? 'run completed',
    });
    return updated;
  }

  async fail(id: string, error: string, reason?: string): Promise<Run> {
    const run = await this.findById(id);
    validateTerminalWrite(run.status, 'FAILED');
    const updated = await this.runsRepository.update(id, {
      status: 'FAILED',
      error,
      completedAt: new Date(),
    } as never);
    await this.recordTransition({
      runId: id,
      fromStatus: run.status,
      toStatus: 'FAILED',
      fromPhase: (run as { currentPhase?: string | null }).currentPhase ?? null,
      toPhase: (updated as { currentPhase?: string | null }).currentPhase ?? null,
      reason: reason ?? 'run failed',
    });
    return updated;
  }

  async cancel(id: string, reason?: string): Promise<Run> {
    const run = await this.findById(id);
    validateTerminalWrite(run.status, 'CANCELLED');
    const updated = await this.runsRepository.update(id, {
      status: 'CANCELLED',
      completedAt: new Date(),
    } as never);
    await this.recordTransition({
      runId: id,
      fromStatus: run.status,
      toStatus: 'CANCELLED',
      fromPhase: (run as { currentPhase?: string | null }).currentPhase ?? null,
      toPhase: (updated as { currentPhase?: string | null }).currentPhase ?? null,
      reason: reason ?? 'run cancelled',
    });
    return updated;
  }

  async transitions(id: string) {
    await this.findById(id);
    return this.runsRepository.listTransitions(id);
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

  async recordModelUsage(
    id: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    estimatedCost = 0,
  ): Promise<Run> {
    const run = await this.findById(id);
    return this.runsRepository.update(id, {
      promptTokens: Number(run.promptTokens ?? 0) + usage.promptTokens,
      completionTokens: Number(run.completionTokens ?? 0) + usage.completionTokens,
      totalTokens: Number(run.totalTokens ?? 0) + usage.totalTokens,
      estimatedCost: Number(run.estimatedCost ?? 0) + estimatedCost,
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

  async claimAutomationCreation(id: string): Promise<boolean> {
    const run = await this.findById(id);
    const currentMetadata = (run.metadata as Record<string, unknown> | null) ?? {};
    const isAutomationDesign =
      currentMetadata.runtimeMode === 'automation_design' ||
      Boolean(currentMetadata.automationDesign) ||
      Boolean(currentMetadata.blueprint);
    if (!isAutomationDesign || currentMetadata.designStatus !== 'READY_FOR_REVIEW') {
      return false;
    }

    return this.runsRepository.claimAutomationCreation(id, run.version, {
      ...currentMetadata,
      runtimeMode: 'automation_design',
      approvalStatus: 'PROVISIONING',
    });
  }

  /**
   * Best-effort transition journal: a transition row must never break the
   * lifecycle write it describes, so journal failures are swallowed after a
   * best-effort attempt.
   */
  private async recordTransition(entry: {
    runId: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromPhase?: string | null;
    toPhase?: string | null;
    reason?: string | null;
  }): Promise<void> {
    try {
      await this.runsRepository.createTransition(entry);
    } catch {
      /* best-effort */
    }
  }
  private validateTransition(current: string, next: string): void {
    validateStatusTransition(current, next);
  }
}
