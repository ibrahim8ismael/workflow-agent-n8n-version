import { describe, expect, it, vi } from 'vitest';
import type { ToolManifestService } from '../../../infrastructure/tools/tool-manifest.service';
import { ToolRegistryService } from './tool-registry.service';

const manifest = (overrides: Record<string, unknown> = {}) => ({
  type: 'function' as const,
  function: {
    name: 'integration_status',
    description: 'Check integration readiness',
    parameters: { type: 'object' },
  },
  woops: {
    kind: 'read' as const,
    implemented: true,
    sideEffect: 'none' as const,
    approval: 'not_required' as const,
    scope: 'user_or_organization' as const,
    availableIn: ['automation_design' as const],
    idempotencyKey: undefined,
    ...overrides,
  },
});

describe('ToolRegistryService', () => {
  it('maps manifests into stable tool definitions', () => {
    const manifests = {
      list: vi.fn().mockReturnValue([manifest()]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests);

    expect(service.list()[0]).toMatchObject({
      id: 'integration_status',
      slug: 'integration_status',
      requiresApproval: false,
      sideEffect: false,
      idempotent: false,
      permissionScope: 'user_or_organization',
      retryPolicy: { maxAttempts: 1 },
    });
  });

  it('delegates implemented and mode filtering to the manifest boundary', () => {
    const manifests = {
      list: vi.fn().mockReturnValue([]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests);

    service.list({ mode: 'execution' });

    expect(manifests.list).toHaveBeenCalledWith({ mode: 'execution' });
  });

  it('finds and requires stable names', () => {
    const manifests = {
      list: vi.fn().mockReturnValue([manifest()]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests);

    expect(service.find('integration_status')?.name).toBe('integration_status');
    expect(() => service.require('missing')).toThrow('not available');
  });

  it('listForAgent returns static tools for the scoped agent', async () => {
    const manifests = {
      list: vi.fn().mockReturnValue([manifest()]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests);

    const tools = await service.listForAgent('agent-1', {
      mode: 'automation_design',
      userId: 'user-1',
      organizationId: 'org-1',
    });

    expect(tools.map((tool) => tool.id)).toEqual(['integration_status']);
  });
});
