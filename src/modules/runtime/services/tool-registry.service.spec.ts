import { describe, expect, it, vi } from 'vitest';
import type { ToolManifestService } from '../../../infrastructure/tools/tool-manifest.service';
import type { AgentsService } from '../../agents/services/agents.service';
import { ToolRegistryService } from './tool-registry.service';

const manifest = (overrides: Record<string, unknown> = {}) => ({
  type: 'function' as const,
  function: {
    name: 'employee_create_draft',
    description: 'Create a draft employee',
    parameters: { type: 'object' },
  },
  woops: {
    kind: 'mutate' as const,
    implemented: true,
    sideEffect: 'record_creation' as const,
    approval: 'required' as const,
    scope: 'user_or_organization' as const,
    availableIn: ['employee_design' as const],
    idempotencyKey: 'designRunId',
    ...overrides,
  },
});

describe('ToolRegistryService', () => {
  const agents = (skills: unknown[] = []) =>
    ({
      getAssignedSkills: vi.fn().mockResolvedValue(skills),
    }) as unknown as AgentsService;

  it('maps manifests into stable tool definitions', () => {
    const manifests = {
      list: vi.fn().mockReturnValue([manifest()]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests, agents());

    expect(service.list()[0]).toMatchObject({
      id: 'employee_create_draft',
      slug: 'employee_create_draft',
      requiresApproval: true,
      sideEffect: true,
      idempotent: true,
      permissionScope: 'user_or_organization',
      retryPolicy: { maxAttempts: 1 },
    });
  });

  it('delegates implemented and mode filtering to the manifest boundary', () => {
    const manifests = {
      list: vi.fn().mockReturnValue([]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests, agents());

    service.list({ mode: 'execution' });

    expect(manifests.list).toHaveBeenCalledWith({ mode: 'execution' });
  });

  it('finds and requires stable names', () => {
    const manifests = {
      list: vi.fn().mockReturnValue([manifest({ sideEffect: 'none', approval: 'not_required' })]),
    } as unknown as ToolManifestService;
    const service = new ToolRegistryService(manifests, agents());

    expect(service.find('employee_create_draft')?.name).toBe('employee_create_draft');
    expect(() => service.require('missing')).toThrow('not available');
  });

  it('returns static tools and only active skills assigned to the scoped agent', async () => {
    const manifests = {
      list: vi.fn().mockReturnValue([manifest({ sideEffect: 'none', approval: 'not_required' })]),
    } as unknown as ToolManifestService;
    const assignedSkill = {
      id: 'assignment-1',
      skillId: 'skill-1',
      name: 'Assigned skill',
      enabled: true,
      skill: {
        id: 'skill-1',
        name: 'Assigned skill',
        slug: 'assigned_skill',
        description: 'Assigned capability',
        executionMode: 'AI_ONLY',
        status: 'ACTIVE',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'string' },
        timeout: 4_000,
        retryPolicy: { maxAttempts: 2, retryableCodes: ['TEMPORARY'] },
        successCriteria: ['Returns a result'],
        metadata: { availableIn: ['execution'], sideEffect: 'none' },
        userId: 'user-1',
      },
    };
    const assignedAgents = agents([assignedSkill]);
    const service = new ToolRegistryService(manifests, assignedAgents);

    const tools = await service.listForAgent('agent-1', {
      mode: 'execution',
      userId: 'user-1',
      organizationId: 'org-1',
    });

    expect(tools.map((tool) => tool.id)).toEqual(['employee_create_draft', 'assigned_skill']);
    expect(tools[1]).toMatchObject({
      executionMode: 'ai',
      timeoutMs: 4_000,
      maxRetries: 1,
      idempotent: false,
      permissionScope: 'user_or_organization',
    });
    expect(assignedAgents.getAssignedSkills).toHaveBeenCalledWith('agent-1', {
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  it('does not expose assigned skills outside their configured runtime mode', async () => {
    const manifests = { list: vi.fn().mockReturnValue([]) } as unknown as ToolManifestService;
    const assignedAgents = agents([
      {
        id: 'assignment-1',
        skillId: 'skill-1',
        name: 'Planning skill',
        enabled: true,
        skill: {
          id: 'skill-1',
          name: 'Planning skill',
          slug: 'planning_skill',
          executionMode: 'AI_ONLY',
          status: 'ACTIVE',
          metadata: { availableIn: ['planning'] },
        },
      },
    ]);
    const service = new ToolRegistryService(manifests, assignedAgents);

    await expect(service.listForAgent('agent-1', { mode: 'execution' })).resolves.toEqual([]);
  });
});
