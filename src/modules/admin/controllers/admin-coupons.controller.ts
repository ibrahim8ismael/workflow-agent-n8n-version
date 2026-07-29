import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CouponService } from '../../billing/services/coupon.service';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class AdminCouponsController {
  constructor(private readonly couponService: CouponService) {}

  @Get()
  async findAll(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.couponService.findAll(Number(limit) || 50, Number(offset) || 0);
  }

  @Post()
  async create(
    @Body()
    dto: {
      code: string;
      type: string;
      value: number;
      maxRedemptions?: number;
      expiresAt?: string;
    },
  ) {
    return this.couponService.create({
      ...dto,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.couponService.update(id, dto as any);
  }
}
