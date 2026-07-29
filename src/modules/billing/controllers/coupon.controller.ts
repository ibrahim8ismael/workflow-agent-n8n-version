import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { CouponService } from '../services/coupon.service';
import { redeemCouponSchema, RedeemCouponDto } from '../dto/redeem-coupon.dto';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';

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
