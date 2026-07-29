import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { UsageMeterService } from '../services/usage-meter.service';
import { SubscriptionService } from '../services/subscription.service';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

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
