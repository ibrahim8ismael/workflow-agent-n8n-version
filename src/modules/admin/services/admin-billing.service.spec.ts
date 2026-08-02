import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletTransactionType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletRepository } from '../../billing/repositories/wallet.repository';
import { WalletService } from '../../billing/services/wallet.service';
import { AdminBillingService } from './admin-billing.service';

describe('AdminBillingService', () => {
  let service: AdminBillingService;

  const wallet = (overrides: Record<string, unknown> = {}) => ({
    id: 'wallet-1',
    balanceCredits: 1000n,
    ...overrides,
  });

  const mockWalletRepo = {
    findById: vi.fn(),
  } as unknown as WalletRepository;

  const mockWalletService = {
    addCredits: vi.fn(),
    deductCredits: vi.fn(),
    freezeWallet: vi.fn(),
    unfreezeWallet: vi.fn(),
  } as unknown as WalletService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockWalletRepo.findById).mockResolvedValue(wallet() as never);
    vi.mocked(mockWalletService.addCredits).mockResolvedValue({ id: 'tx-1' } as never);
    vi.mocked(mockWalletService.deductCredits).mockResolvedValue({
      transactionId: 'tx-1',
      balanceBefore: 1000n,
      balanceAfter: 990n,
      type: WalletTransactionType.CONSUMPTION,
    } as never);
    vi.mocked(mockWalletService.freezeWallet).mockResolvedValue(
      wallet({ isFrozen: true }) as never,
    );
    vi.mocked(mockWalletService.unfreezeWallet).mockResolvedValue(wallet() as never);
    service = new AdminBillingService(mockWalletService, mockWalletRepo);
  });

  describe('topUp', () => {
    it('should throw when the wallet is missing', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(null);

      await expect(service.topUp('missing', 100n, 'bonus')).rejects.toThrow(NotFoundException);
    });

    it('should credit the wallet as an admin adjustment', async () => {
      await service.topUp('wallet-1', 100n, 'bonus');

      expect(mockWalletService.addCredits).toHaveBeenCalledWith('wallet-1', 100n, 0, {
        type: WalletTransactionType.ADJUSTMENT,
        description: 'Admin top-up: bonus',
        referenceType: 'admin_adjustment',
      });
    });
  });

  describe('deduct', () => {
    it('should throw when the wallet is missing', async () => {
      vi.mocked(mockWalletRepo.findById).mockResolvedValue(null);

      await expect(service.deduct('missing', 10n, 'clawback')).rejects.toThrow(NotFoundException);
    });

    it('should reject non-positive amounts', async () => {
      await expect(service.deduct('wallet-1', 0n, 'x')).rejects.toThrow(BadRequestException);
    });

    it('should deduct credits as an admin adjustment', async () => {
      const result = await service.deduct('wallet-1', 10n, 'clawback');

      expect(mockWalletService.deductCredits).toHaveBeenCalledWith('wallet-1', 10n, {
        description: 'Admin deduction: clawback',
        referenceType: 'admin_adjustment',
      });
      expect(result.balanceAfter).toBe(990n);
    });
  });

  describe('freeze / unfreeze', () => {
    it('should delegate to the wallet service', async () => {
      await service.freezeWallet('wallet-1');
      await service.unfreezeWallet('wallet-1');

      expect(mockWalletService.freezeWallet).toHaveBeenCalledWith('wallet-1');
      expect(mockWalletService.unfreezeWallet).toHaveBeenCalledWith('wallet-1');
    });
  });
});
