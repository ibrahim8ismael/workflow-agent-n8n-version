export class OperationsConsumedEvent {
  constructor(
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly amount: bigint,
    public readonly balanceBefore: bigint,
    public readonly balanceAfter: bigint,
    public readonly idempotencyKey: string,
    public readonly userId?: string,
    public readonly organizationId?: string,
  ) {}
}
