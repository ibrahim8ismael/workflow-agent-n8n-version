import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
