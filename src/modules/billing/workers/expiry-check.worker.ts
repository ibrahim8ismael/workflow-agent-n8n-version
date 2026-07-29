import { Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type { QueueService } from '../../../infrastructure/queue/queue.service';
import { BILLING_QUEUES } from '../constants/billing.constants';
import type { SubscriptionService } from '../services/subscription.service';

@Injectable()
export class ExpiryCheckWorker implements OnModuleInit {
  private readonly logger = new Logger(ExpiryCheckWorker.name);

  constructor(
    @Optional() private readonly queueService: QueueService | null,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  onModuleInit() {
    if (!this.queueService) {
      this.logger.warn('QueueService not available, skipping worker initialization');
      return;
    }
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
