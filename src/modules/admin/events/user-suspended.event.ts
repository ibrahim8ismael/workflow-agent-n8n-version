export class UserSuspendedEvent {
  constructor(
    public readonly userId: string,
    public readonly adminId: string,
    public readonly reason: string,
  ) {}
}
