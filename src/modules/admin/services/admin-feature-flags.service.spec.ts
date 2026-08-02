import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../database/database.service';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

describe('AdminFeatureFlagsService', () => {
  let service: AdminFeatureFlagsService;

  const flag = (overrides: Record<string, unknown> = {}) => ({
    id: 'flag-1',
    key: 'beta.chat',
    name: 'Beta Chat',
    enabled: true,
    ...overrides,
  });

  const override = (overrides: Record<string, unknown> = {}) => ({
    id: 'override-1',
    flagId: 'flag-1',
    entityType: 'user',
    entityId: 'user-1',
    enabled: true,
    ...overrides,
  });

  const mockDb = {
    featureFlag: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    featureFlagOverride: {
      upsert: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
  } as unknown as DatabaseService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockDb.featureFlag.findMany).mockResolvedValue([flag()] as never);
    vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(flag() as never);
    vi.mocked(mockDb.featureFlag.create).mockResolvedValue(flag() as never);
    vi.mocked(mockDb.featureFlag.update).mockResolvedValue(flag() as never);
    vi.mocked(mockDb.featureFlagOverride.upsert).mockResolvedValue(override() as never);
    vi.mocked(mockDb.featureFlagOverride.delete).mockResolvedValue(override() as never);
    vi.mocked(mockDb.featureFlagOverride.findFirst).mockResolvedValue(null as never);
    service = new AdminFeatureFlagsService(mockDb);
  });

  describe('findAll / findByKey', () => {
    it('should list flags with overrides', async () => {
      await service.findAll();

      expect(mockDb.featureFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { overrides: true } }),
      );
    });

    it('should return the flag when found', async () => {
      const result = await service.findByKey('beta.chat');

      expect(result.key).toBe('beta.chat');
    });

    it('should throw when the flag is missing', async () => {
      vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(null as never);

      await expect(service.findByKey('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create / update', () => {
    it('should reject duplicate flag keys', async () => {
      await expect(service.create({ key: 'beta.chat', name: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create a new flag', async () => {
      vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(null as never);

      await service.create({ key: 'beta.new', name: 'New' });

      expect(mockDb.featureFlag.create).toHaveBeenCalledWith({
        data: { key: 'beta.new', name: 'New' },
      });
    });

    it('should update an existing flag', async () => {
      await service.update('beta.chat', { enabled: false });

      expect(mockDb.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { enabled: false } }),
      );
    });
  });

  describe('setOverride / removeOverride', () => {
    it('should upsert an override for a user', async () => {
      await service.setOverride('beta.chat', 'user', 'user-1', true, 'testing');

      expect(mockDb.featureFlagOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            flagId: 'flag-1',
            entityType: 'user',
            entityId: 'user-1',
            enabled: true,
            reason: 'testing',
          },
        }),
      );
    });

    it('should delete an override', async () => {
      await service.removeOverride('beta.chat', 'user', 'user-1');

      expect(mockDb.featureFlagOverride.delete).toHaveBeenCalled();
    });
  });

  describe('isEnabled', () => {
    it('should return false when the flag does not exist', async () => {
      vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(null as never);

      const result = await service.isEnabled('missing');

      expect(result).toBe(false);
    });

    it('should return true when the flag is enabled', async () => {
      const result = await service.isEnabled('beta.chat');

      expect(result).toBe(true);
    });

    it('should respect a user override when the flag is disabled', async () => {
      vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(
        flag({ enabled: false }) as never as never,
      );
      vi.mocked(mockDb.featureFlagOverride.findFirst).mockResolvedValue(
        override({ entityType: 'user', enabled: true }) as never as never,
      );

      const result = await service.isEnabled('beta.chat', { userId: 'user-1' });

      expect(result).toBe(true);
      expect(mockDb.featureFlagOverride.findFirst).toHaveBeenCalledWith({
        where: { flagId: 'flag-1', entityType: 'user', entityId: 'user-1' },
      });
    });

    it('should respect an organization override when the flag is disabled', async () => {
      vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(
        flag({ enabled: false }) as never as never,
      );
      vi.mocked(mockDb.featureFlagOverride.findFirst).mockResolvedValue(
        override({ entityType: 'organization', enabled: true }) as never as never,
      );

      const result = await service.isEnabled('beta.chat', { organizationId: 'org-1' });

      expect(result).toBe(true);
    });

    it('should fall back to the flag value when no override exists', async () => {
      vi.mocked(mockDb.featureFlag.findUnique).mockResolvedValue(
        flag({ enabled: false }) as never as never,
      );

      const result = await service.isEnabled('beta.chat', { userId: 'user-1' });

      expect(result).toBe(false);
    });
  });
});
