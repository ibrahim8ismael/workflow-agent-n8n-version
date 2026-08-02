import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageMeterRepository } from '../repositories/usage-meter.repository';
import { UsageMeterService } from './usage-meter.service';

describe('UsageMeterService', () => {
  let service: UsageMeterService;

  const meter = { id: 'meter-1', subscriptionId: 'sub-1', aiCreditsUsed: 10n };

  const mockRepo = {
    create: vi.fn(),
    findCurrent: vi.fn(),
    incrementAiCredits: vi.fn(),
    incrementOperations: vi.fn(),
    reset: vi.fn(),
    findDueForReset: vi.fn(),
  } as unknown as UsageMeterRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findCurrent).mockResolvedValue(meter as never);
    service = new UsageMeterService(mockRepo);
  });

  describe('createMeter', () => {
    it('should delegate to the repository', async () => {
      const data = { aiCreditsLimit: 5000n, operationsLimit: 100n, resetAt: new Date() };

      await service.createMeter('sub-1', data);

      expect(mockRepo.create).toHaveBeenCalledWith({ subscriptionId: 'sub-1', ...data });
    });
  });

  describe('recordAiCreditsUsage', () => {
    it('should increment the current meter', async () => {
      await service.recordAiCreditsUsage('sub-1', 25n);

      expect(mockRepo.findCurrent).toHaveBeenCalledWith('sub-1');
      expect(mockRepo.incrementAiCredits).toHaveBeenCalledWith('meter-1', 25n);
    });

    it('should throw when no active meter exists', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(null);

      await expect(service.recordAiCreditsUsage('sub-1', 25n)).rejects.toThrow(
        'No active usage meter found',
      );
    });
  });

  describe('recordOperationsUsage', () => {
    it('should increment the current meter', async () => {
      await service.recordOperationsUsage('sub-1', 5n);

      expect(mockRepo.incrementOperations).toHaveBeenCalledWith('meter-1', 5n);
    });

    it('should throw when no active meter exists', async () => {
      vi.mocked(mockRepo.findCurrent).mockResolvedValue(null);

      await expect(service.recordOperationsUsage('sub-1', 5n)).rejects.toThrow(
        'No active usage meter found',
      );
    });
  });

  describe('getCurrentUsage / resetMeter / findDueForReset', () => {
    it('should return the current meter', async () => {
      const result = await service.getCurrentUsage('sub-1');

      expect(result).toEqual(meter);
    });

    it('should delegate reset', async () => {
      const data = { aiCreditsLimit: 1n, operationsLimit: 2n, resetAt: new Date() };

      await service.resetMeter('sub-1', data.aiCreditsLimit, data.operationsLimit, data.resetAt);

      expect(mockRepo.reset).toHaveBeenCalledWith('sub-1', 1n, 2n, data.resetAt);
    });

    it('should delegate findDueForReset', async () => {
      await service.findDueForReset();

      expect(mockRepo.findDueForReset).toHaveBeenCalled();
    });
  });
});
