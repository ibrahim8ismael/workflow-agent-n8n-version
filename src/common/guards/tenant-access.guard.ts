import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | { id: string; activeContext?: string; organizationId?: string }
      | undefined;

    if (!user?.id) throw new ForbiddenException('Authenticated user context is required');
    if (user.activeContext !== 'organization') return true;
    if (!user.organizationId) throw new ForbiddenException('Active organization is required');

    const membership = await this.db.organizationMember.findFirst({
      where: { userId: user.id, organizationId: user.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('User is not an active organization member');

    return true;
  }
}
