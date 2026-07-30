import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
