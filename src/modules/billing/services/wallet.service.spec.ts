import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletTransactionType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletRepository } from '../repositories/wallet.repository';
import { WalletTransactionRepository } from '../repositories/wallet-transaction.repository';
import { BillingEventService } from './billing-event.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;

  const wallet = (overrides: Record<string, unknown> = {}) => ({
    id: 'wallet-1',
    balanceCredits: 1000n,
    balanceCreditsUsd: 0,
    lifetimeCredits: 1000n,
    lifetimeSpendUsd: 0,
    currency: 'USD',
    isFrozen: false,
    version: 1,
    ...overrides,
  });

  const mockWalletRepo = {
    findById: vi.fn(),
    getOrCreateForUser: vi.fn(),
    getOrCreateForOrganization: vi.fn(),
    deductCreditsAtomic: vi.fn(),
    addCreditsWithUsdAtomic: vi.fn(),
    freeze: vi.fn(),
    unfreeze: vi.fn(),
  } as unknown as WalletRepository;

  const mockTxRepo = {
    findByReference: vi.fn(),
    create: vi.fn(),
    findByWalletId: vi.fn(),
  } as unknown as WalletTransactionRepository;

  const mockBillingEvent = {
    logCreditConsumed: vi.fn(),
  } as unknown as BillingEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockWalletRepo.findById).mockResolvedValue(wallet() as never);
    vi.mocked(mockWalletRepo.deductCreditsAtomic).mockResolvedValue(
      wallet({ balanceCredits: 990n }) as never,
    );
    vi.mocked(mockWalletRepo.addCreditsWithUsdAtomic).mockResolvedValue(undefined as never);
    vi.mocked(mockTxRepo.create).mockResolvedValue({ id: 'tx-1' } as never);
    vi.mocked(mockBillingEvent.logCreditConsumed).mockResolvedValue(undefined as never);
    service = new WalletService(mockWalletRepo, mockTxRepo, mockBillingEvent);
  });

  describe('getBalance', () => {
    it('should return the wallet with BigInt fields serialized to numbers', async () => {
      const result = await service.getBalance('wallet-1');

      expect(result).toMatchObject({ id: 'wallet-1', balanceCredits: 1000 });
      expect(JSON.stringify(result)).toContain('"balanceCredits":1000');
    });

    it('should throw when the wallet does not exist', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(null);

      await expect(service.getBalance('missing')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrCreateWallet', () => {
    it('should create for a user when userId is present', async () => {
      await service.getOrCreateWallet({ userId: 'user-1' });

      expect(mockWalletRepo.getOrCreateForUser).toHaveBeenCalledWith('user-1');
      expect(mockWalletRepo.getOrCreateForOrganization).not.toHaveBeenCalled();
    });

    it('should create for an organization when organizationId is present', async () => {
      await service.getOrCreateWallet({ organizationId: 'org-1' });

      expect(mockWalletRepo.getOrCreateForOrganization).toHaveBeenCalledWith('org-1');
    });

    it('should throw when neither userId nor organizationId is provided', async () => {
      await expect(service.getOrCreateWallet({})).rejects.toThrow(BadRequestException);
    });
  });

  describe('deductCredits', () => {
    it('should reject non-positive amounts', async () => {
      await expect(service.deductCredits('wallet-1', 0n, {})).rejects.toThrow(
        'Amount must be positive',
      );
    });

    it('should return the existing transaction for a duplicate reference', async () => {
      vi.mocked(mockTxRepo.findByReference).mockResolvedValue({
        id: 'tx-existing',
        balanceBefore: 100n,
        balanceAfter: 90n,
        type: WalletTransactionType.CONSUMPTION,
      } as never);

      const result = await service.deductCredits('wallet-1', 5n, {
        referenceType: 'run',
        referenceId: 'run-1',
      });

      expect(result).toMatchObject({ transactionId: 'tx-existing' });
      expect(mockWalletRepo.deductCreditsAtomic).not.toHaveBeenCalled();
    });

    it('should throw when the wallet is missing', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(null);

      await expect(service.deductCredits('missing', 5n, {})).rejects.toThrow('Wallet not found');
    });

    it('should throw when the wallet is frozen', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(wallet({ isFrozen: true }) as never);

      await expect(service.deductCredits('wallet-1', 5n, {})).rejects.toThrow('Wallet is frozen');
    });

    it('should throw when credits are insufficient', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(
        wallet({ balanceCredits: 10n }) as never,
      );

      await expect(service.deductCredits('wallet-1', 20n, {})).rejects.toThrow(
        'Insufficient credits',
      );
    });

    it('should throw on concurrent modification', async () => {
      vi.mocked(mockWalletRepo.deductCreditsAtomic).mockResolvedValue(null as never);

      await expect(service.deductCredits('wallet-1', 5n, {})).rejects.toThrow(ConflictException);
    });

    it('should deduct, record a transaction and log the event', async () => {
      const result = await service.deductCredits('wallet-1', 10n, {
        description: 'AI run',
        userId: 'user-1',
      });

      expect(mockWalletRepo.deductCreditsAtomic).toHaveBeenCalledWith('wallet-1', 10n, 1);
      expect(mockTxRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: WalletTransactionType.CONSUMPTION,
          amountCredits: -10n,
          balanceBefore: 1000n,
          balanceAfter: 990n,
        }),
      );
      expect(mockBillingEvent.logCreditConsumed).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: 'wallet-1', amount: 10n, userId: 'user-1' }),
      );
      expect(result).toEqual({
        transactionId: 'tx-1',
        balanceBefore: 1000n,
        balanceAfter: 990n,
        type: WalletTransactionType.CONSUMPTION,
      });
    });
  });

  describe('addCredits', () => {
    it('should reject non-positive credits', async () => {
      await expect(
        service.addCredits('wallet-1', 0n, 10, { type: WalletTransactionType.TOP_UP_PURCHASE }),
      ).rejects.toThrow('Credits must be positive');
    });

    it('should throw when the wallet does not exist', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(null);

      await expect(
        service.addCredits('wallet-1', 100n, 10, { type: WalletTransactionType.TOP_UP_PURCHASE }),
      ).rejects.toThrow('Wallet not found');
    });

    it('should credit the wallet atomically and record the transaction', async () => {
      await service.addCredits('wallet-1', 500n, 4.99, {
        type: WalletTransactionType.TOP_UP_PURCHASE,
        description: 'Top-up',
      });

      expect(mockWalletRepo.addCreditsWithUsdAtomic).toHaveBeenCalledWith('wallet-1', 500n, 4.99);
      expect(mockTxRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: 'wallet-1',
          type: WalletTransactionType.TOP_UP_PURCHASE,
          amountCredits: 500n,
          amountUsd: 4.99,
          balanceBefore: 1000n,
          balanceAfter: 1500n,
        }),
      );
    });
  });

  describe('getTransactions / freeze / unfreeze', () => {
    it('should delegate transaction queries', async () => {
      await service.getTransactions('wallet-1', 10, 5);

      expect(mockTxRepo.findByWalletId).toHaveBeenCalledWith('wallet-1', 10, 5);
    });

    it('should serialize BigInt fields in transactions', async () => {
      vi.mocked(mockTxRepo.findByWalletId).mockResolvedValue([
        { id: 'tx-1', amountCredits: -10n, balanceBefore: 1000n, balanceAfter: 990n },
      ] as never);

      const result = await service.getTransactions('wallet-1');

      expect(JSON.stringify(result)).toContain('"amountCredits":-10');
      expect(result[0]).toMatchObject({ id: 'tx-1', balanceAfter: 990 });
    });

    it('should delegate freeze and unfreeze', async () => {
      await service.freezeWallet('wallet-1');
      await service.unfreezeWallet('wallet-1');

      expect(mockWalletRepo.freeze).toHaveBeenCalledWith('wallet-1');
      expect(mockWalletRepo.unfreeze).toHaveBeenCalledWith('wallet-1');
    });
  });
});
