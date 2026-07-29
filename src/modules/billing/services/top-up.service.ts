import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { TopUpRepository } from '../repositories/top-up.repository';
import { WalletService } from './wallet.service';
import { BillingEventService } from './billing-event.service';

@Injectable()
export class TopUpService {
  private readonly logger = new Logger(TopUpService.name);

  constructor(
    private readonly topUpRepo: TopUpRepository,
    private readonly walletService: WalletService,
    private readonly billingEvent: BillingEventService,
  ) {}

  async findAllPackages() {
    return this.topUpRepo.findAllActivePackages();
  }

  async findPackageById(id: string) {
    const pkg = await this.topUpRepo.findPackageById(id);
    if (!pkg) throw new NotFoundException('Top-up package not found');
    return pkg;
  }

  async purchase(packageId: string, entity: { userId?: string; organizationId?: string }) {
    const pkg = await this.findPackageById(packageId);

    const wallet = await this.walletService.getOrCreateWallet(entity);

    const purchase = await this.topUpRepo.createPurchase({
      packageId,
      walletId: wallet.id,
      amountPaidUsd: Number(pkg.priceUsd),
      creditsGranted: pkg.creditsAmount,
      operationsGranted: pkg.operationsAmount ?? undefined,
      status: 'COMPLETED',
      provider: 'internal',
    });

    await this.walletService.addCredits(wallet.id, pkg.creditsAmount, Number(pkg.priceUsd), {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'TOP_UP_PURCHASE' as any,
      description: `Top-up: ${pkg.name}`,
      referenceType: 'top_up_purchase',
      referenceId: purchase.id,
    });

    await this.billingEvent.logTopUpPurchased({
      purchaseId: purchase.id,
      walletId: wallet.id,
      packageId,
      amountPaidUsd: Number(pkg.priceUsd),
      creditsGranted: pkg.creditsAmount,
      userId: entity.userId,
      organizationId: entity.organizationId,
    });

    return purchase;
  }

  async getPurchaseHistory(walletId: string) {
    return this.topUpRepo.findByWalletId(walletId);
  }

  async getPurchaseById(id: string) {
    const purchase = await this.topUpRepo.findPurchaseById(id);
    if (!purchase) throw new NotFoundException('Purchase not found');
    return purchase;
  }
}
