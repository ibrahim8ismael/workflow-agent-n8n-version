export class OrganizationCreatedEvent {
  constructor(
    public organizationId: string,
    public ownerId: string,
  ) {}
}
