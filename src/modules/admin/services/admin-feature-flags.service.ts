import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AdminFeatureFlagsService {
  constructor(private readonly db: DatabaseService) {}

  async findAll() {
    return this.db.featureFlag.findMany({
      where: { deletedAt: null },
      orderBy: { key: 'asc' },
      include: { overrides: true },
    });
  }

  async findByKey(key: string) {
    const flag = await this.db.featureFlag.findUnique({
      where: { key, deletedAt: null },
      include: { overrides: true },
    });
    if (!flag) throw new NotFoundException(`Feature flag '${key}' not found`);
    return flag;
  }

  async create(data: {
    key: string;
    name: string;
    description?: string;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await this.db.featureFlag.findUnique({ where: { key: data.key } });
    if (existing) throw new BadRequestException(`Feature flag '${data.key}' already exists`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.featureFlag.create({ data: { ...data, metadata: data.metadata as any } });
  }

  async update(
    key: string,
    data: {
      name?: string;
      description?: string;
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.findByKey(key);
    return this.db.featureFlag.update({
      where: { key },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...data, metadata: data.metadata as any },
    });
  }

  async setOverride(
    flagKey: string,
    entityType: string,
    entityId: string,
    enabled: boolean,
    reason?: string,
  ) {
    const flag = await this.findByKey(flagKey);

    return this.db.featureFlagOverride.upsert({
      where: {
        flagId_entityType_entityId: {
          flagId: flag.id,
          entityType,
          entityId,
        },
      },
      create: { flagId: flag.id, entityType, entityId, enabled, reason },
      update: { enabled, reason },
    });
  }

  async removeOverride(flagKey: string, entityType: string, entityId: string) {
    const flag = await this.findByKey(flagKey);

    return this.db.featureFlagOverride.delete({
      where: {
        flagId_entityType_entityId: {
          flagId: flag.id,
          entityType,
          entityId,
        },
      },
    });
  }

  async isEnabled(
    key: string,
    context?: { userId?: string; organizationId?: string },
  ): Promise<boolean> {
    const flag = await this.db.featureFlag.findUnique({ where: { key } });
    if (!flag) return false;
    if (flag.enabled) return true;

    if (context) {
      if (context.userId) {
        const override = await this.db.featureFlagOverride.findFirst({
          where: {
            flagId: flag.id,
            entityType: 'user',
            entityId: context.userId,
          },
        });
        if (override) return override.enabled;
      }
      if (context.organizationId) {
        const override = await this.db.featureFlagOverride.findFirst({
          where: {
            flagId: flag.id,
            entityType: 'organization',
            entityId: context.organizationId,
          },
        });
        if (override) return override.enabled;
      }
    }

    return flag.enabled;
  }
}
