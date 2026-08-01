import { Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { BILLING_QUEUES } from '../constants/billing.constants';
import { SubscriptionService } from '../services/subscription.service';

@Injectable()
export class SubscriptionRenewalWorker implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionRenewalWorker.name);

  constructor(
    @Optional() private readonly queueService: QueueService | null,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  onModuleInit() {
    if (!this.queueService) {
      this.logger.warn('QueueService not available, skipping worker initialization');
      return;
    }
    this.queueService.createWorker(BILLING_QUEUES.SUBSCRIPTION_RENEWAL, async (job) => {
      const { subscriptionId } = job.data as { subscriptionId: string };
      try {
        await this.subscriptionService.renew(subscriptionId);
        this.logger.log(`Renewed subscription: ${subscriptionId}`);
      } catch (error) {
        this.logger.error(`Failed to renew subscription ${subscriptionId}:`, error);
        throw error;
      }
    });

    this.logger.log('SubscriptionRenewalWorker initialized');
  }
}
