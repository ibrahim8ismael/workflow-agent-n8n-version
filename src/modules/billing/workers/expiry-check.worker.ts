import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { SubscriptionService } from '../services/subscription.service';
import { BILLING_QUEUES } from '../constants/billing.constants';

@Injectable()
export class ExpiryCheckWorker implements OnModuleInit {
  private readonly logger = new Logger(ExpiryCheckWorker.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  onModuleInit() {
    this.queueService.createWorker(BILLING_QUEUES.EXPIRY_CHECK, async () => {
      try {
        const expired = await this.subscriptionService.findExpired();
        for (const sub of expired) {
          this.logger.log(`Marking expired subscription: ${sub.id}`);
          await this.subscriptionService.cancel(sub.id);
        }
        this.logger.log(`Expired ${expired.length} subscriptions`);
      } catch (error) {
        this.logger.error('Failed to check expired subscriptions:', error);
        throw error;
      }
    });

    this.logger.log('ExpiryCheckWorker initialized');
  }
}
