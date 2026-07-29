import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class UserOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: string; role: string } | undefined;
    const targetId = request.params.id;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (user.id === targetId || user.role === 'SYSTEM_ADMINISTRATOR') {
      return true;
    }

    throw new UnauthorizedException('You do not have access to this user');
  }
}
