import { ForbiddenException, Injectable } from '@nestjs/common';
import type { ToolDefinition } from '../interfaces/tool.interface';

export interface ToolPermissionContext {
  agentId: string;
  userId?: string;
  organizationId?: string;
  permissions?: string[];
}

@Injectable()
export class ToolPermissionService {
  assertAllowed(tool: ToolDefinition, context: ToolPermissionContext): void {
    const granted = new Set(context.permissions ?? []);
    for (const permission of tool.requiredPermissions) {
      if (this.hasPermission(permission, context, granted)) continue;
      throw new ForbiddenException(`Missing permission "${permission}" for tool "${tool.name}"`);
    }
  }

  private hasPermission(
    permission: string,
    context: ToolPermissionContext,
    granted: Set<string>,
  ): boolean {
    if (granted.has(permission)) return true;
    if (!permission.startsWith('scope:')) return false;

    switch (permission.slice('scope:'.length)) {
      case 'user_or_organization':
        return Boolean(context.userId || context.organizationId);
      case 'organization':
        return Boolean(context.organizationId);
      case 'employee':
        return Boolean(context.agentId);
      case 'user':
        return Boolean(context.userId);
      default:
        return false;
    }
  }
}
