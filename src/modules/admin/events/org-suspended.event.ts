export class OrganizationSuspendedEvent {
  constructor(
    public readonly organizationId: string,
    public readonly adminId: string,
    public readonly reason: string,
  ) {}
}
