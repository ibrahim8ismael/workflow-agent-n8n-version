import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { type PurchaseTopUpDto, purchaseTopUpSchema } from '../dto/purchase-top-up.dto';
import type { TopUpService } from '../services/top-up.service';

@Controller('top-up')
@UseGuards(JwtAuthGuard)
export class TopUpController {
  constructor(private readonly topUpService: TopUpService) {}

  @Get('packages')
  async getPackages() {
    return this.topUpService.findAllPackages();
  }

  @Get('packages/:id')
  async getPackage(@Param('id') id: string) {
    return this.topUpService.findPackageById(id);
  }

  @Post('purchase')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async purchase(@Body() dto: PurchaseTopUpDto, @Req() req: any) {
    const data = purchaseTopUpSchema.parse(dto);
    const { id: userId, activeContext, organizationId } = req.user;
    return this.topUpService.purchase(data.packageId, {
      userId: activeContext === 'organization' ? undefined : userId,
      organizationId: activeContext === 'organization' ? organizationId : undefined,
    });
  }

  @Get('purchases')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPurchases(@Req() req: any) {
    const { id: userId, activeContext, organizationId } = req.user;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletService = (this.topUpService as any).walletService;
    const wallet = await walletService.getOrCreateWallet(
      activeContext === 'organization' && organizationId ? { organizationId } : { userId },
    );
    return this.topUpService.getPurchaseHistory(wallet.id);
  }

  @Get('purchases/:id')
  async getPurchase(@Param('id') id: string) {
    return this.topUpService.getPurchaseById(id);
  }
}
