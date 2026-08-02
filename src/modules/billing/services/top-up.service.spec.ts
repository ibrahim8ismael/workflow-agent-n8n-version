import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopUpRepository } from '../repositories/top-up.repository';
import { BillingEventService } from './billing-event.service';
import { TopUpService } from './top-up.service';
import { WalletService } from './wallet.service';

describe('TopUpService', () => {
  let service: TopUpService;

  const pkg = {
    id: 'pkg-1',
    name: 'Starter Pack',
    priceUsd: 9.99,
    creditsAmount: 1000n,
    operationsAmount: 50n,
    isActive: true,
  };

  const mockTopUpRepo = {
    findAllActivePackages: vi.fn(),
    findPackageById: vi.fn(),
    createPurchase: vi.fn(),
    findByWalletId: vi.fn(),
    findPurchaseById: vi.fn(),
  } as unknown as TopUpRepository;

  const mockWalletService = {
    getOrCreateWallet: vi.fn(),
    addCredits: vi.fn(),
  } as unknown as WalletService;

  const mockBillingEvent = {
    logTopUpPurchased: vi.fn(),
  } as unknown as BillingEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockTopUpRepo.findPackageById).mockResolvedValue(pkg as never);
    vi.mocked(mockWalletService.getOrCreateWallet).mockResolvedValue({ id: 'wallet-1' } as never);
    vi.mocked(mockTopUpRepo.createPurchase).mockResolvedValue({ id: 'purchase-1' } as never);
    vi.mocked(mockWalletService.addCredits).mockResolvedValue({ id: 'tx-1' } as never);
    vi.mocked(mockBillingEvent.logTopUpPurchased).mockResolvedValue(undefined as never);
    service = new TopUpService(mockTopUpRepo, mockWalletService, mockBillingEvent);
  });

  describe('findAllPackages / findPackageById', () => {
    it('should list active packages', async () => {
      await service.findAllPackages();

      expect(mockTopUpRepo.findAllActivePackages).toHaveBeenCalled();
    });

    it('should return a package when found', async () => {
      const result = await service.findPackageById('pkg-1');

      expect(result).toEqual(pkg);
    });

    it('should throw when the package is missing', async () => {
      vi.mocked(mockTopUpRepo.findPackageById).mockResolvedValue(null);

      await expect(service.findPackageById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('purchase', () => {
    it('should create a purchase, grant credits and log the event', async () => {
      const result = await service.purchase('pkg-1', { userId: 'user-1' });

      expect(mockWalletService.getOrCreateWallet).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(mockTopUpRepo.createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          packageId: 'pkg-1',
          walletId: 'wallet-1',
          amountPaidUsd: 9.99,
          creditsGranted: 1000n,
          operationsGranted: 50n,
          status: 'COMPLETED',
        }),
      );
      expect(mockWalletService.addCredits).toHaveBeenCalledWith(
        'wallet-1',
        1000n,
        9.99,
        expect.objectContaining({
          type: 'TOP_UP_PURCHASE',
          description: 'Top-up: Starter Pack',
          referenceType: 'top_up_purchase',
          referenceId: 'purchase-1',
        }),
      );
      expect(mockBillingEvent.logTopUpPurchased).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseId: 'purchase-1',
          walletId: 'wallet-1',
          packageId: 'pkg-1',
          creditsGranted: 1000n,
          userId: 'user-1',
        }),
      );
      expect(result).toEqual({ id: 'purchase-1' });
    });
  });

  describe('getPurchaseHistory / getPurchaseById', () => {
    it('should list purchases for a wallet', async () => {
      await service.getPurchaseHistory('wallet-1');

      expect(mockTopUpRepo.findByWalletId).toHaveBeenCalledWith('wallet-1');
    });

    it('should return a purchase when found', async () => {
      vi.mocked(mockTopUpRepo.findPurchaseById).mockResolvedValue({ id: 'purchase-1' } as never);

      const result = await service.getPurchaseById('purchase-1');

      expect(result).toEqual({ id: 'purchase-1' });
    });

    it('should throw when the purchase is missing', async () => {
      vi.mocked(mockTopUpRepo.findPurchaseById).mockResolvedValue(null);

      await expect(service.getPurchaseById('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
