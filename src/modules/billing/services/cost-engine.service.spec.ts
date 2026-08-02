import { beforeEach, describe, expect, it } from 'vitest';
import { CostEngineService } from './cost-engine.service';

describe('CostEngineService', () => {
  let service: CostEngineService;

  beforeEach(() => {
    service = new CostEngineService();
  });

  describe('calculateAiCost', () => {
    it('should compute cost for a known model', () => {
      const cost = service.calculateAiCost('gpt-4o', 1000, 500, 0);

      expect(cost).toBe(8n);
    });

    it('should use default multipliers for unknown models', () => {
      const cost = service.calculateAiCost('some-future-model', 1000, 500, 0);

      expect(cost).toBe(3n);
    });

    it('should never return less than 1 credit', () => {
      expect(service.calculateAiCost('gpt-4o-mini', 1, 1, 0)).toBe(1n);
      expect(service.calculateAiCost('gpt-4o', 0, 0, 0)).toBe(1n);
    });
  });

  describe('calculateOperationCost', () => {
    it('should return the base cost for known operation types', () => {
      expect(service.calculateOperationCost('http')).toBe(10n);
      expect(service.calculateOperationCost('code')).toBe(25n);
      expect(service.calculateOperationCost('database')).toBe(15n);
      expect(service.calculateOperationCost('browser')).toBe(50n);
    });

    it('should fall back to 10 for unknown operation types', () => {
      expect(service.calculateOperationCost('mystery-op')).toBe(10n);
    });
  });

  describe('calculateTotal', () => {
    it('should combine AI and operation costs with a breakdown', () => {
      const result = service.calculateTotal('gpt-4o', 1000, 500, 0, 'code');

      expect(result.creditsConsumed).toBe(8n);
      expect(result.operationsConsumed).toBe(25n);
      expect(result.breakdown).toEqual({ ai: 8n, ops: 25n });
    });
  });
});
