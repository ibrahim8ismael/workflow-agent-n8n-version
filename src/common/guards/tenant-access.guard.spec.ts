import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TenantAccessGuard } from './tenant-access.guard';

const context = (user: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

describe('TenantAccessGuard', () => {
  it('allows an authenticated individual user without organization membership', async () => {
    const db = { organizationMember: { findFirst: vi.fn() } };
    const guard = new TenantAccessGuard(db as never);

    await expect(
      guard.canActivate(context({ id: 'user-1', activeContext: 'individual' })),
    ).resolves.toBe(true);
    expect(db.organizationMember.findFirst).not.toHaveBeenCalled();
  });

  it('requires active membership for organization context', async () => {
    const db = { organizationMember: { findFirst: vi.fn().mockResolvedValue(null) } };
    const guard = new TenantAccessGuard(db as never);

    await expect(
      guard.canActivate(
        context({ id: 'user-1', activeContext: 'organization', organizationId: 'org-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(db.organizationMember.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', organizationId: 'org-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('allows an active organization member', async () => {
    const db = { organizationMember: { findFirst: vi.fn().mockResolvedValue({ id: 'member-1' }) } };
    const guard = new TenantAccessGuard(db as never);

    await expect(
      guard.canActivate(
        context({ id: 'user-1', activeContext: 'organization', organizationId: 'org-1' }),
      ),
    ).resolves.toBe(true);
  });
});
