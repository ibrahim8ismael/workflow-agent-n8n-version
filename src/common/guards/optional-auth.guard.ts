import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(err: Error | null, user: TUser): TUser {
    return user;
  }
}
