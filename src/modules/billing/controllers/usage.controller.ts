import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import type { SubscriptionService } from '../services/subscription.service';
import type { UsageMeterService } from '../services/usage-meter.service';

@Controller('usage')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(
    private readonly usageMeter: UsageMeterService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getUsage(@Req() req: any) {
    const { id: userId, activeContext, organizationId } = req.user;
    const sub = await this.subscriptionService.getCurrent(
      activeContext === 'organization' ? undefined : userId,
      activeContext === 'organization' ? organizationId : undefined,
    );
    if (!sub) return { aiCreditsUsed: 0, operationsUsed: 0 };
    return this.usageMeter.getCurrentUsage(sub.id);
  }
}
