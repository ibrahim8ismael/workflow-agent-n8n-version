import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import type { WalletService } from '../services/wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getBalance(@Req() req: any) {
    const { id: userId, activeContext, organizationId } = req.user;
    const wallet = await this.walletService.getOrCreateWallet(
      activeContext === 'organization' && organizationId ? { organizationId } : { userId },
    );
    return this.walletService.getBalance(wallet.id);
  }

  @Get('transactions')
  async getTransactions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { id: userId, activeContext, organizationId } = req.user;
    const wallet = await this.walletService.getOrCreateWallet(
      activeContext === 'organization' && organizationId ? { organizationId } : { userId },
    );
    return this.walletService.getTransactions(wallet.id, Number(limit) || 50, Number(offset) || 0);
  }
}
