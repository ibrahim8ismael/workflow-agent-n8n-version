import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class PlanGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
