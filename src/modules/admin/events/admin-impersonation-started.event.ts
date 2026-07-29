export class AdminImpersonationStartedEvent {
  constructor(
    public readonly adminId: string,
    public readonly targetUserId: string,
    public readonly reason: string,
  ) {}
}
