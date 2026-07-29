export class TopUpPurchasedEvent {
  constructor(
    public readonly purchaseId: string,
    public readonly walletId: string,
    public readonly packageId: string,
    public readonly amountPaidUsd: number,
    public readonly creditsGranted: bigint,
    public readonly userId?: string,
    public readonly organizationId?: string,
  ) {}
}
