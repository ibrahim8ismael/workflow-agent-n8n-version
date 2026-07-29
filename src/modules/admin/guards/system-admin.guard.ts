import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: string; role: string } | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (user.role !== 'SYSTEM_ADMINISTRATOR') {
      throw new UnauthorizedException('System administrator access required');
    }

    return true;
  }
}
