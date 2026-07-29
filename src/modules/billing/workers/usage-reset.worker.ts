import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { UsageMeterService } from '../services/usage-meter.service';
import { BILLING_QUEUES } from '../constants/billing.constants';

@Injectable()
export class UsageResetWorker implements OnModuleInit {
  private readonly logger = new Logger(UsageResetWorker.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly usageMeter: UsageMeterService,
  ) {}

  onModuleInit() {
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
