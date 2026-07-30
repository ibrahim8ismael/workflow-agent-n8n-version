import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import {
  type CreditAdjustmentDto,
  creditAdjustmentSchema,
} from '../dto/admin-credit-adjustment.dto';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import type { AdminBillingService } from '../services/admin-billing.service';

@Controller('admin/wallets')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminBillingController {
  constructor(private readonly billingService: AdminBillingService) {}

  @Post(':id/top-up')
  async topUp(@Param('id') id: string, @Body() dto: CreditAdjustmentDto) {
    const data = creditAdjustmentSchema.parse(dto);
    return this.billingService.topUp(id, BigInt(data.credits), data.description);
  }

  @Post(':id/deduct')
  async deduct(@Param('id') id: string, @Body() dto: CreditAdjustmentDto) {
    const data = creditAdjustmentSchema.parse(dto);
    return this.billingService.deduct(id, BigInt(data.credits), data.description);
  }

  @Post(':id/freeze')
  async freeze(@Param('id') id: string) {
    return this.billingService.freezeWallet(id);
  }

  @Post(':id/unfreeze')
  async unfreeze(@Param('id') id: string) {
    return this.billingService.unfreezeWallet(id);
  }
}
