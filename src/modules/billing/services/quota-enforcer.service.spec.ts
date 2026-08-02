import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageMeterRepository } from '../repositories/usage-meter.repository';
import { QuotaEnforcerService } from './quota-enforcer.service';

describe('QuotaEnforcerService', () => {
  let service: QuotaEnforcerService;

  const meter = (overrides: Record<string, unknown> = {}) => ({
    id: 'meter-1',
    aiCreditsUsed: 100n,
    aiCreditsLimit: 1000n,
    operationsUsed: 10n,
    operationsLimit: 100n,
    ...overrides,
  });

  const mockRepo = {
    findCurrent: vi.fn(),
  } as unknown as UsageMeterRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findCurrent).mockResolvedValue(meter() as never);
    service = new QuotaEnforcerService(mockRepo);
  });

  describe('checkAiCredits', () => {
    it('should allow usage well within limits', async () => {
      const result = await service.checkAiCredits('sub-1', 10n);

      expect(result).toMatchObject({
        allowed: true,
        reason: undefined,
        currentUsage: 100n,
        limit: 1000n,
        isSoftLimitReached: false,
        isHardLimitReached: false,
      });
    });

    it('should report a soft limit when projected usage exceeds 80%', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(
        meter({ aiCreditsUsed: 900n }) as never as never,
      );

      const result = await service.checkAiCredits('sub-1', 10n);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Soft limit reached');
      expect(result.isSoftLimitReached).toBe(true);
    });

    it('should deny when projected usage exceeds the grace threshold', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(
        meter({ aiCreditsUsed: 1100n }) as never as never,
      );

      const result = await service.checkAiCredits('sub-1', 10n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Hard limit reached');
      expect(result.isHardLimitReached).toBe(true);
    });

    it('should deny when the plan has no AI credits', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(
        meter({ aiCreditsLimit: 0n }) as never as never,
      );

      const result = await service.checkAiCredits('sub-1', 10n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('AI Credits not available on this plan');
    });

    it('should deny when no usage meter exists', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(null as never);

      const result = await service.checkAiCredits('sub-1', 10n);

      expect(result).toMatchObject({
        allowed: false,
        reason: 'No usage meter found',
        isHardLimitReached: true,
      });
    });
  });

  describe('checkOperations', () => {
    it('should allow usage well within limits', async () => {
      const result = await service.checkOperations('sub-1', 1n);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should report a soft limit when projected usage exceeds 80%', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(
        meter({ operationsUsed: 90n }) as never as never,
      );

      const result = await service.checkOperations('sub-1', 1n);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Soft limit reached');
    });

    it('should deny when projected usage exceeds the grace threshold', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(
        meter({ operationsUsed: 110n }) as never as never,
      );

      const result = await service.checkOperations('sub-1', 1n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Hard limit reached');
    });

    it('should deny when the plan has no operations', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(
        meter({ operationsLimit: 0n }) as never as never,
      );

      const result = await service.checkOperations('sub-1', 1n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Operations not available on this plan');
    });

    it('should deny when no usage meter exists', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(null as never);

      const result = await service.checkOperations('sub-1', 1n);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No usage meter found');
    });
  });
});
