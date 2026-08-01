import { Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { BILLING_QUEUES } from '../constants/billing.constants';
import { UsageMeterService } from '../services/usage-meter.service';

@Injectable()
export class UsageResetWorker implements OnModuleInit {
  private readonly logger = new Logger(UsageResetWorker.name);

  constructor(
    @Optional() private readonly queueService: QueueService | null,
    private readonly usageMeter: UsageMeterService,
  ) {}

  onModuleInit() {
    if (!this.queueService) {
      this.logger.warn('QueueService not available, skipping worker initialization');
      return;
    }
    this.queueService.createWorker(BILLING_QUEUES.USAGE_RESET, async (job) => {
      const { subscriptionId, aiCreditsLimit, operationsLimit, resetAt } = job.data as {
        subscriptionId: string;
        aiCreditsLimit: bigint;
        operationsLimit: bigint;
        resetAt: string;
      };
      try {
        await this.usageMeter.resetMeter(
          subscriptionId,
          aiCreditsLimit,
          operationsLimit,
          new Date(resetAt),
        );
        this.logger.log(`Reset usage meter for subscription: ${subscriptionId}`);
      } catch (error) {
        this.logger.error(`Failed to reset usage meter ${subscriptionId}:`, error);
        throw error;
      }
    });

    this.logger.log('UsageResetWorker initialized');
  }
}
