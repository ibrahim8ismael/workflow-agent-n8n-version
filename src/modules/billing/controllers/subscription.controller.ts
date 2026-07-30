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
import type { SubscriptionService } from '../services/subscription.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const data = createSubscriptionSchema.parse(dto);
    const userId = req.user.id;
    return this.subscriptionService.create({
      planId: data.planId,
      userId,
      organizationId: data.organizationId,
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
  async upgrade(@Param('id') id: string, @Body() dto: UpgradeSubscriptionDto) {
    const data = upgradeSubscriptionSchema.parse(dto);
    return this.subscriptionService.upgrade(id, data.planId);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string) {
    return this.subscriptionService.cancel(id);
  }
}
