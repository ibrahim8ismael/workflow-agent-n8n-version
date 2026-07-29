import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { SubscriptionService } from '../services/subscription.service';
import { BILLING_QUEUES } from '../constants/billing.constants';

@Injectable()
export class SubscriptionRenewalWorker implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionRenewalWorker.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  onModuleInit() {
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
