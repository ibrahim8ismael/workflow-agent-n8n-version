import { Injectable } from '@nestjs/common';
import {
  GRACE_LIMIT_THRESHOLD,
  HARD_LIMIT_THRESHOLD,
  SOFT_LIMIT_THRESHOLD,
} from '../constants/billing.constants';
import type { IQuotaCheckResult } from '../interfaces/billing.interface';
import type { UsageMeterRepository } from '../repositories/usage-meter.repository';

@Injectable()
export class QuotaEnforcerService {
  constructor(private readonly usageMeterRepo: UsageMeterRepository) {}

  async checkAiCredits(subscriptionId: string, estimatedCost: bigint): Promise<IQuotaCheckResult> {
    const meter = await this.usageMeterRepo.findCurrent(subscriptionId);
    if (!meter) {
      return {
        allowed: false,
        reason: 'No usage meter found',
        currentUsage: BigInt(0),
        limit: BigInt(0),
        isSoftLimitReached: false,
        isHardLimitReached: true,
      };
    }

    const projectedUsage = meter.aiCreditsUsed + estimatedCost;
    const limit = meter.aiCreditsLimit;

    if (limit === BigInt(0)) {
      return {
        allowed: false,
        reason: 'AI Credits not available on this plan',
        currentUsage: meter.aiCreditsUsed,
        limit,
        isSoftLimitReached: true,
        isHardLimitReached: true,
      };
    }

    const usageRatio = Number(projectedUsage) / Number(limit);
    const currentRatio = Number(meter.aiCreditsUsed) / Number(limit);

    return {
      allowed: usageRatio <= GRACE_LIMIT_THRESHOLD,
      reason:
        usageRatio > HARD_LIMIT_THRESHOLD
          ? 'Hard limit reached'
          : usageRatio > SOFT_LIMIT_THRESHOLD
            ? 'Soft limit reached'
            : undefined,
      currentUsage: meter.aiCreditsUsed,
      limit,
      isSoftLimitReached: currentRatio >= SOFT_LIMIT_THRESHOLD,
      isHardLimitReached: currentRatio >= HARD_LIMIT_THRESHOLD,
    };
  }

  async checkOperations(subscriptionId: string, estimatedCost: bigint): Promise<IQuotaCheckResult> {
    const meter = await this.usageMeterRepo.findCurrent(subscriptionId);
    if (!meter) {
      return {
        allowed: false,
        reason: 'No usage meter found',
        currentUsage: BigInt(0),
        limit: BigInt(0),
        isSoftLimitReached: false,
        isHardLimitReached: true,
      };
    }

    const projectedUsage = meter.operationsUsed + estimatedCost;
    const limit = meter.operationsLimit;

    if (limit === BigInt(0)) {
      return {
        allowed: false,
        reason: 'Operations not available on this plan',
        currentUsage: meter.operationsUsed,
        limit,
        isSoftLimitReached: true,
        isHardLimitReached: true,
      };
    }

    const usageRatio = Number(projectedUsage) / Number(limit);
    const currentRatio = Number(meter.operationsUsed) / Number(limit);

    return {
      allowed: usageRatio <= GRACE_LIMIT_THRESHOLD,
      reason:
        usageRatio > HARD_LIMIT_THRESHOLD
          ? 'Hard limit reached'
          : usageRatio > SOFT_LIMIT_THRESHOLD
            ? 'Soft limit reached'
            : undefined,
      currentUsage: meter.operationsUsed,
      limit,
      isSoftLimitReached: currentRatio >= SOFT_LIMIT_THRESHOLD,
      isHardLimitReached: currentRatio >= HARD_LIMIT_THRESHOLD,
    };
  }
}
