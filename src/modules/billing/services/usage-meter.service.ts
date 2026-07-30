import { Injectable } from '@nestjs/common';
import type { UsageMeterRepository } from '../repositories/usage-meter.repository';

@Injectable()
export class UsageMeterService {
  constructor(private readonly usageMeterRepo: UsageMeterRepository) {}

  async createMeter(
    subscriptionId: string,
    data: {
      aiCreditsLimit: bigint;
      operationsLimit: bigint;
      resetAt: Date;
    },
  ) {
    return this.usageMeterRepo.create({
      subscriptionId,
      aiCreditsLimit: data.aiCreditsLimit,
      operationsLimit: data.operationsLimit,
      resetAt: data.resetAt,
    });
  }

  async recordAiCreditsUsage(subscriptionId: string, amount: bigint) {
    const meter = await this.usageMeterRepo.findCurrent(subscriptionId);
    if (!meter) {
      throw new Error('No active usage meter found');
    }
    return this.usageMeterRepo.incrementAiCredits(meter.id, amount);
  }

  async recordOperationsUsage(subscriptionId: string, amount: bigint) {
    const meter = await this.usageMeterRepo.findCurrent(subscriptionId);
    if (!meter) {
      throw new Error('No active usage meter found');
    }
    return this.usageMeterRepo.incrementOperations(meter.id, amount);
  }

  async getCurrentUsage(subscriptionId: string) {
    return this.usageMeterRepo.findCurrent(subscriptionId);
  }

  async resetMeter(
    subscriptionId: string,
    aiCreditsLimit: bigint,
    operationsLimit: bigint,
    resetAt: Date,
  ) {
    return this.usageMeterRepo.reset(subscriptionId, aiCreditsLimit, operationsLimit, resetAt);
  }

  async findDueForReset() {
    return this.usageMeterRepo.findDueForReset();
  }
}
