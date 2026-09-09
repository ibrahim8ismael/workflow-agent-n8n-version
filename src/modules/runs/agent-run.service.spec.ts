import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunService } from './agent-run.service';
import { AGENT_RUN_PHASE } from './agent-run-phase';
import { RunsRepository } from './runs.repository';

describe('AgentRunService', () => {
  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    agentId: 'agent-1',
    conversationId: 'conv-1',
    status: 'EXECUTING',
    currentPhase: AGENT_RUN_PHASE.UNDERSTANDING,
    version: 3,
    ...overrides,
  });

  const mockRepo = {
    createAgentRun: vi.fn(),
    transitionRun: vi.fn(),
    findById: vi.fn(),
    listTransitions: vi.fn().mockResolvedValue([]),
  } as unknown as RunsRepository;

  let service: AgentRunService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findById).mockResolvedValue(run() as never);
    vi.mocked(mockRepo.transitionRun).mockImplementation((_id, _version, data) =>
      Promise.resolve(run({ ...(data as Record<string, unknown>), version: 4 }) as never),
    );
    vi.mocked(mockRepo.createAgentRun).mockImplementation((data) =>
      Promise.resolve(run({ ...(data as Record<string, unknown>) }) as never),
    );
    service = new AgentRunService(mockRepo);
  });

  describe('createAgentRun', () => {
    it('creates a run in UNDERSTANDING/CREATED with the lifecycle defaults', async () => {
      await service.createAgentRun({ agentId: 'agent-1', conversationId: 'conv-1' });

      expect(mockRepo.createAgentRun).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'CREATED',
          currentPhase: AGENT_RUN_PHASE.UNDERSTANDING,
          repairAttempts: [],
          metadata: expect.objectContaining({ agentRunVersion: 'v2' }),
        }),
        'agent run created',
      );
    });

    it('seeds business context when provided', async () => {
      await service.createAgentRun({
        agentId: 'agent-1',
        businessContext: { industry: 'retail' },
      });

      expect(mockRepo.createAgentRun).toHaveBeenCalledWith(
        expect.objectContaining({ businessContext: { industry: 'retail' } }),
        expect.anything(),
      );
    });
  });

  describe('advance', () => {
    it('advances the phase and journals the transition with a reason', async () => {
      const result = await service.advance('run-1', {
        toPhase: AGENT_RUN_PHASE.PLANNING,
        reason: 'request understood',
      });

      expect(result.currentPhase).toBe(AGENT_RUN_PHASE.PLANNING);
      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({ currentPhase: AGENT_RUN_PHASE.PLANNING }),
        expect.objectContaining({
          fromPhase: AGENT_RUN_PHASE.UNDERSTANDING,
          toPhase: AGENT_RUN_PHASE.PLANNING,
          fromStatus: 'EXECUTING',
          toStatus: 'EXECUTING',
          reason: 'request understood',
        }),
      );
    });

    it('advances phase and status together', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'EXECUTING', currentPhase: AGENT_RUN_PHASE.RUNTIME_VALIDATION }) as never,
      );

      await service.advance('run-1', {
        toPhase: AGENT_RUN_PHASE.COMPLETED,
        toStatus: 'COMPLETED',
      });

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({
          currentPhase: AGENT_RUN_PHASE.COMPLETED,
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        }),
        expect.anything(),
      );
    });

    it('uses the caller-provided version for optimistic concurrency', async () => {
      await service.advance('run-1', {
        toPhase: AGENT_RUN_PHASE.PLANNING,
        expectedVersion: 9,
      });

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        9,
        expect.anything(),
        expect.anything(),
      );
    });

    it('rejects an invalid phase hop', async () => {
      await expect(service.advance('run-1', { toPhase: AGENT_RUN_PHASE.BUILDING })).rejects.toThrow(
        'Invalid agent phase transition: UNDERSTANDING → BUILDING',
      );
      expect(mockRepo.transitionRun).not.toHaveBeenCalled();
    });

    it('walks the repair loop FAILED → DIAGNOSING → REPAIRING → EXECUTING', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'FAILED', currentPhase: AGENT_RUN_PHASE.FAILED }) as never,
      );

      await service.advance('run-1', { toPhase: AGENT_RUN_PHASE.DIAGNOSING });
      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({ currentPhase: AGENT_RUN_PHASE.DIAGNOSING }),
        expect.anything(),
      );

      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'FAILED', currentPhase: AGENT_RUN_PHASE.REPAIRING }) as never,
      );
      await service.advance('run-1', {
        toPhase: AGENT_RUN_PHASE.EXECUTING,
        toStatus: 'EXECUTING',
      });
      expect(mockRepo.transitionRun).toHaveBeenLastCalledWith(
        'run-1',
        3,
        expect.objectContaining({ status: 'EXECUTING' }),
        expect.anything(),
      );
    });

    it('rejects moves out of terminal statuses (repair-resume excepted)', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'COMPLETED', currentPhase: AGENT_RUN_PHASE.COMPLETED }) as never,
      );

      await expect(service.advance('run-1', { toStatus: 'EXECUTING' })).rejects.toThrow(
        'COMPLETED is terminal and cannot move to EXECUTING',
      );
    });

    it('refuses COMPLETED status unless the phase is COMPLETED', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'EXECUTING', currentPhase: AGENT_RUN_PHASE.EXECUTING }) as never,
      );

      await expect(service.advance('run-1', { toStatus: 'COMPLETED' })).rejects.toThrow(
        'completion requires the COMPLETED phase',
      );
      expect(mockRepo.transitionRun).not.toHaveBeenCalled();
    });

    it('refuses FAILED status unless the phase is FAILED', async () => {
      await expect(service.advance('run-1', { toStatus: 'FAILED' })).rejects.toThrow(
        'failure must land in the FAILED phase',
      );
      expect(mockRepo.transitionRun).not.toHaveBeenCalled();
    });

    it('refuses backward status moves', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'GENERATING', currentPhase: AGENT_RUN_PHASE.EXECUTING }) as never,
      );

      await expect(service.advance('run-1', { toStatus: 'EXECUTING' })).rejects.toThrow(
        'moves backward',
      );
    });

    it('allows a forward status jump alongside a valid phase hop', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'CREATED', currentPhase: AGENT_RUN_PHASE.UNDERSTANDING }) as never,
      );

      await service.advance('run-1', {
        toPhase: AGENT_RUN_PHASE.PLANNING,
        toStatus: 'EXECUTING',
      });

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({
          currentPhase: AGENT_RUN_PHASE.PLANNING,
          status: 'EXECUTING',
        }),
        expect.anything(),
      );
    });

    it('throws ConflictException on a concurrent modification', async () => {
      vi.mocked(mockRepo.transitionRun).mockResolvedValue(null);

      await expect(service.advance('run-1', { toPhase: AGENT_RUN_PHASE.PLANNING })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for unknown runs', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(null);

      await expect(
        service.advance('missing', { toPhase: AGENT_RUN_PHASE.PLANNING }),
      ).rejects.toThrow(NotFoundException);
    });

    it('is a no-op when nothing changes', async () => {
      const result = await service.advance('run-1', {});

      expect(result.id).toBe('run-1');
      expect(mockRepo.transitionRun).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('moves a WAITING run back to EXECUTING', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'WAITING', currentPhase: AGENT_RUN_PHASE.BUILDING }) as never,
      );

      await service.resume('run-1');

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({ status: 'EXECUTING' }),
        expect.objectContaining({ reason: 'run resumed' }),
      );
    });

    it('refuses to resume terminal runs', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'FAILED', currentPhase: AGENT_RUN_PHASE.FAILED }) as never,
      );

      await expect(service.resume('run-1')).rejects.toThrow(ConflictException);
    });

    it('returns an already-running run unchanged', async () => {
      const result = await service.resume('run-1');

      expect(result.status).toBe('EXECUTING');
      expect(mockRepo.transitionRun).not.toHaveBeenCalled();
    });
  });

  describe('isRepairable', () => {
    it('is true for FAILED runs in a repairable phase', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'FAILED', currentPhase: AGENT_RUN_PHASE.DIAGNOSING }) as never,
      );

      await expect(service.isRepairable('run-1')).resolves.toBe(true);
    });

    it('is false for FAILED runs in a non-repairable phase', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ status: 'FAILED', currentPhase: AGENT_RUN_PHASE.PLANNING }) as never,
      );

      await expect(service.isRepairable('run-1')).resolves.toBe(false);
    });
  });

  describe('snapshot / cancel', () => {
    it('returns the run with its transition trail', async () => {
      vi.mocked(mockRepo.listTransitions).mockResolvedValue([
        { id: 't1', runId: 'run-1', reason: 'agent run created' },
      ] as never);

      const snapshot = await service.snapshot('run-1');

      expect(snapshot.run.id).toBe('run-1');
      expect(snapshot.transitions).toHaveLength(1);
    });

    it('cancels a live run from any non-terminal state', async () => {
      await service.cancel('run-1', 'user requested');

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({ status: 'CANCELLED', completedAt: expect.any(Date) }),
        expect.objectContaining({ reason: 'user requested' }),
      );
    });
  });

  describe('appendRepairAttempt', () => {
    it('appends to the repair trail with a version guard', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(
        run({ repairAttempts: [{ attempt: 1 }] }) as never,
      );

      await service.appendRepairAttempt('run-1', {
        attempt: 2,
        at: new Date().toISOString(),
        stage: 'test',
        code: 'API_ERROR',
        diagnosis: 'transient outage',
        changes: [],
        blueprintRevision: 'rev-2',
      });

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({
          repairAttempts: [{ attempt: 1 }, expect.objectContaining({ attempt: 2 })],
        }),
        expect.objectContaining({ reason: 'repair attempt 2 (API_ERROR)' }),
      );
    });

    it('starts the trail when none exists', async () => {
      vi.mocked(mockRepo.findById).mockResolvedValue(run({ repairAttempts: null }) as never);

      await service.appendRepairAttempt('run-1', {
        attempt: 1,
        at: new Date().toISOString(),
        stage: 'test',
        code: 'TIMEOUT',
        diagnosis: 'slow instance',
        changes: [],
        blueprintRevision: 'rev-1',
      });

      expect(mockRepo.transitionRun).toHaveBeenCalledWith(
        'run-1',
        3,
        expect.objectContaining({ repairAttempts: [expect.objectContaining({ attempt: 1 })] }),
        expect.anything(),
      );
    });
  });
});
