import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { type RedeemCouponDto, redeemCouponSchema } from '../dto/redeem-coupon.dto';
import type { CouponService } from '../services/coupon.service';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Post('redeem')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async redeem(@Body() dto: RedeemCouponDto, @Req() req: any) {
    const data = redeemCouponSchema.parse(dto);
    const { id: userId, activeContext, organizationId } = req.user;
    return this.couponService.redeem(data.code, userId, {
      userId: activeContext === 'organization' ? undefined : userId,
      organizationId: activeContext === 'organization' ? organizationId : undefined,
    });
  }
}
