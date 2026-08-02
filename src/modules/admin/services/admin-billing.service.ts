import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WalletTransactionType } from '@prisma/client';
import { WalletRepository } from '../../billing/repositories/wallet.repository';
import { WalletService } from '../../billing/services/wallet.service';

@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly walletRepo: WalletRepository,
  ) {}

  async topUp(walletId: string, credits: bigint, description: string) {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    const tx = await this.walletService.addCredits(walletId, credits, 0, {
      type: WalletTransactionType.ADJUSTMENT,
      description: `Admin top-up: ${description}`,
      referenceType: 'admin_adjustment',
    });

    this.logger.log(`Admin top-up: wallet=${walletId}, credits=${credits}`);
    return tx;
  }

  async deduct(walletId: string, credits: bigint, description: string) {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    if (credits <= BigInt(0)) throw new BadRequestException('Credits must be positive');

    const result = await this.walletService.deductCredits(walletId, credits, {
      description: `Admin deduction: ${description}`,
      referenceType: 'admin_adjustment',
    });

    this.logger.log(`Admin deduction: wallet=${walletId}, credits=${credits}`);
    return result;
  }

  async freezeWallet(walletId: string) {
    return this.walletService.freezeWallet(walletId);
  }

  async unfreezeWallet(walletId: string) {
    return this.walletService.unfreezeWallet(walletId);
  }
}
