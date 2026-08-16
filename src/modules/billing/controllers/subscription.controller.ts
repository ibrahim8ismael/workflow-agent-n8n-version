import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import {
  type CreateSubscriptionDto,
  createSubscriptionSchema,
} from '../dto/create-subscription.dto';
import {
  type UpgradeSubscriptionDto,
  upgradeSubscriptionSchema,
} from '../dto/upgrade-subscription.dto';
import { SubscriptionService } from '../services/subscription.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const data = createSubscriptionSchema.parse(dto);
    const { id: userId, activeContext, organizationId } = req.user;
    return this.subscriptionService.create({
      planId: data.planId,
      userId: activeContext === 'organization' ? undefined : userId,
      organizationId: activeContext === 'organization' ? organizationId : undefined,
    });
  }

  @Get('current')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getCurrent(@Req() req: any) {
    const { id: userId, activeContext, organizationId } = req.user;
    if (activeContext === 'organization' && organizationId) {
      return this.subscriptionService.getCurrent(undefined, organizationId);
    }
    return this.subscriptionService.getCurrent(userId);
  }

  @Patch(':id/upgrade')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upgrade(@Param('id') id: string, @Body() dto: UpgradeSubscriptionDto, @Req() req: any) {
    const data = upgradeSubscriptionSchema.parse(dto);
    const { id: userId, activeContext, organizationId } = req.user;
    return this.subscriptionService.upgrade(id, data.planId, {
      userId,
      organizationId: activeContext === 'organization' ? organizationId : undefined,
    });
  }

  @Delete(':id')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async cancel(@Param('id') id: string, @Req() req: any) {
    const { id: userId, activeContext, organizationId } = req.user;
    return this.subscriptionService.cancel(id, {
      userId,
      organizationId: activeContext === 'organization' ? organizationId : undefined,
    });
  }
}
