export class UserCreatedEvent {
  constructor(
    public userId: string,
    public email: string,
  ) {}
}
