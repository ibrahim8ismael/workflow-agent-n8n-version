import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { WalletTransactionType } from '@prisma/client';
import { IConsumptionResult } from '../interfaces/billing.interface';
import { WalletRepository } from '../repositories/wallet.repository';
import { WalletTransactionRepository } from '../repositories/wallet-transaction.repository';
import { BillingEventService } from './billing-event.service';

type WalletRow = Record<string, unknown> & { id: string };

/** BigInt columns are not JSON-serializable — map them to plain numbers. */
function serializeWallet<T extends WalletRow>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out as T;
}

function serializeTransaction<T extends WalletRow>(tx: T): T {
  return serializeWallet(tx);
}

@Injectable()
export class WalletService {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly txRepo: WalletTransactionRepository,
    private readonly billingEvent: BillingEventService,
  ) {}

  async getBalance(walletId: string) {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    return serializeWallet(wallet as unknown as WalletRow);
  }

  async getOrCreateWallet(entity: { userId?: string; organizationId?: string }) {
    if (entity.userId) {
      return this.walletRepo.getOrCreateForUser(entity.userId);
    }
    if (entity.organizationId) {
      return this.walletRepo.getOrCreateForOrganization(entity.organizationId);
    }
    throw new BadRequestException('Either userId or organizationId is required');
  }

  async deductCredits(
    walletId: string,
    amount: bigint,
    options: {
      description?: string;
      referenceType?: string;
      referenceId?: string;
      metadata?: Record<string, unknown>;
      userId?: string;
      organizationId?: string;
    },
  ): Promise<IConsumptionResult> {
    if (amount <= BigInt(0)) throw new BadRequestException('Amount must be positive');

    if (options.referenceId) {
      const existing = await this.txRepo.findByReference(
        options.referenceType ?? 'unknown',
        options.referenceId,
      );
      if (existing) {
        return {
          transactionId: existing.id,
          balanceBefore: existing.balanceBefore,
          balanceAfter: existing.balanceAfter,
          type: existing.type as WalletTransactionType,
        };
      }
    }

    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    if (wallet.isFrozen) throw new BadRequestException('Wallet is frozen');
    if (wallet.balanceCredits < amount) throw new BadRequestException('Insufficient credits');

    const balanceBefore = wallet.balanceCredits;
    const balanceAfter = balanceBefore - amount;

    const updated = await this.walletRepo.deductCreditsAtomic(walletId, amount, wallet.version);
    if (!updated) throw new ConflictException('Concurrent wallet modification detected');

    const tx = await this.txRepo.create({
      walletId,
      type: WalletTransactionType.CONSUMPTION,
      amountCredits: -amount,
      balanceBefore,
      balanceAfter,
      description: options.description,
      referenceType: options.referenceType,
      referenceId: options.referenceId,
      metadata: options.metadata,
    });

    await this.billingEvent.logCreditConsumed({
      walletId,
      transactionId: tx.id,
      amount,
      balanceBefore,
      balanceAfter,
      userId: options.userId,
      organizationId: options.organizationId,
    });

    return {
      transactionId: tx.id,
      balanceBefore,
      balanceAfter,
      type: WalletTransactionType.CONSUMPTION,
    };
  }

  async addCredits(
    walletId: string,
    credits: bigint,
    usdAmount: number,
    options: {
      type: WalletTransactionType;
      description?: string;
      referenceType?: string;
      referenceId?: string;
      metadata?: Record<string, unknown>;
      couponId?: string;
      expiresAt?: Date;
    },
  ) {
    if (credits <= BigInt(0)) throw new BadRequestException('Credits must be positive');

    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) throw new BadRequestException('Wallet not found');

    const balanceBefore = wallet.balanceCredits;
    const balanceAfter = balanceBefore + credits;

    await this.walletRepo.addCreditsWithUsdAtomic(walletId, credits, usdAmount);

    return this.txRepo.create({
      walletId,
      type: options.type,
      amountCredits: credits,
      amountUsd: usdAmount,
      balanceBefore,
      balanceAfter,
      description: options.description,
      referenceType: options.referenceType,
      referenceId: options.referenceId,
      metadata: options.metadata,
      couponId: options.couponId,
      expiresAt: options.expiresAt,
    });
  }

  async getTransactions(walletId: string, limit = 50, offset = 0) {
    const rows = (await this.txRepo.findByWalletId(walletId, limit, offset)) ?? [];
    return rows.map((row) => serializeTransaction(row as unknown as WalletRow));
  }

  async freezeWallet(walletId: string) {
    return this.walletRepo.freeze(walletId);
  }

  async unfreezeWallet(walletId: string) {
    return this.walletRepo.unfreeze(walletId);
  }
}
