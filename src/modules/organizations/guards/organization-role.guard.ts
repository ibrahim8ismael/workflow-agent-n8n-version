import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
