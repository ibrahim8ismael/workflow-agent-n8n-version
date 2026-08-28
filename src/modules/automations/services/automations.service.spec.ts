import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { N8nClientApiError } from '../../../infrastructure/n8n/n8n-client-api.service';
import { N8nProvisionerService } from '../../../infrastructure/n8n/n8n-provisioner.service';
import { N8nConnectionsService } from '../../integrations/n8n/services/n8n-connections.service';
import { AUTOMATION_STATUS } from '../constants/automation-status.constants';
import { AutomationsRepository } from '../repositories/automations.repository';
import { automationBlueprintSchema } from '../schemas/automation-blueprint.schema';
import { AutomationsService } from './automations.service';

const blueprint = automationBlueprintSchema.parse({
  ready: true,
  missingRequirements: [],
  name: 'Invoice sync',
  goal: 'Sync paid invoices to the ledger',
  summary: 'Fetches paid invoices daily.',
  description: '',
  trigger: { type: 'schedule', config: {} },
  steps: [{ name: 'Fetch', action: 'Fetch invoices', integration: 'stripe', config: {} }],
  integrations: ['stripe'],
  inputContract: {},
  outputContract: {},
  riskNotes: [],
});

const automationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'auto-1',
  name: 'Invoice sync',
  description: null,
  blueprint,
  status: AUTOMATION_STATUS.PENDING_APPROVAL,
  connectionId: 'conn-1',
  externalWorkflowId: null,
  webhookPath: null,
  lastSyncedAt: null,
  lastError: null,
  userId: 'user-1',
  organizationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

describe('AutomationsService', () => {
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    findActiveConnectionId: ReturnType<typeof vi.fn>;
  };
  let provisioner: { provision: ReturnType<typeof vi.fn> };
  let connections: { resolveCredentials: ReturnType<typeof vi.fn> };
  let service: AutomationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = {
      create: vi.fn().mockImplementation(async (data) => automationRow({ ...data })),
      findById: vi.fn().mockResolvedValue(automationRow()),
      list: vi.fn().mockResolvedValue([automationRow()]),
      update: vi.fn().mockImplementation(async (_id, data) => automationRow({ ...data })),
      softDelete: vi.fn().mockResolvedValue(automationRow({ deletedAt: new Date() })),
      findActiveConnectionId: vi.fn().mockResolvedValue('conn-1'),
    } as never;
    provisioner = {
      provision: vi
        .fn()
        .mockResolvedValue({ externalWorkflowId: 'wf-1', webhookPath: 'invoice-sync-b7e2c1aa' }),
    } as never;
    connections = {
      resolveCredentials: vi
        .fn()
        .mockResolvedValue({ baseUrl: 'https://client.example.com', apiKey: 'key' }),
    } as never;
    service = new AutomationsService(
      repository as unknown as AutomationsRepository,
      provisioner as unknown as N8nProvisionerService,
      connections as unknown as N8nConnectionsService,
    );
  });

  it('persists an approved blueprint in PENDING_APPROVAL with an active connection', async () => {
    const result = await service.createFromBlueprint(
      { name: 'Invoice sync', blueprint: blueprint as unknown as Record<string, unknown> },
      { userId: 'user-1' },
    );

    expect(result.status).toBe(AUTOMATION_STATUS.PENDING_APPROVAL);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AUTOMATION_STATUS.PENDING_APPROVAL,
        connection: { connect: { id: 'conn-1' } },
      }),
    );
  });

  it('refuses to persist a blueprint when no ACTIVE connection exists', async () => {
    repository.findActiveConnectionId = vi.fn().mockResolvedValue(null);

    await expect(
      service.createFromBlueprint(
        { name: 'Invoice sync', blueprint: blueprint as unknown as Record<string, unknown> },
        { userId: 'user-1' },
      ),
    ).rejects.toThrow('No ACTIVE n8n connection');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('approves a pending automation: PROVISIONING → ACTIVE with binding captured', async () => {
    const result = await service.approve('auto-1', { userId: 'user-1' });

    expect(provisioner.provision).toHaveBeenCalledWith(
      expect.objectContaining({ automationId: 'auto-1', blueprint }),
    );
    expect(result.status).toBe(AUTOMATION_STATUS.ACTIVE);
    expect(result.externalWorkflowId).toBe('wf-1');
    expect(result.webhookPath).toBe('invoice-sync-b7e2c1aa');
  });

  it('never provisions automations that were not approved', async () => {
    repository.findById = vi
      .fn()
      .mockResolvedValue(automationRow({ status: AUTOMATION_STATUS.DESIGN }));

    await expect(service.approve('auto-1', { userId: 'user-1' })).rejects.toThrow(
      'has not been approved for provisioning',
    );
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it('records FAILED with a surfaced error when provisioning throws', async () => {
    provisioner.provision = vi.fn().mockRejectedValue(new N8nClientApiError('boom', 'API_ERROR'));

    const result = await service.approve('auto-1', { userId: 'user-1' });

    expect(result.status).toBe(AUTOMATION_STATUS.FAILED);
    expect(result.lastError).toContain('boom');
  });

  it('records FAILED when the bound connection is not ACTIVE', async () => {
    connections.resolveCredentials = vi.fn().mockResolvedValue(null);

    const result = await service.approve('auto-1', { userId: 'user-1' });

    expect(result.status).toBe(AUTOMATION_STATUS.FAILED);
    expect(result.lastError).toContain('not ACTIVE');
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it('throws a scoped 404 for foreign owners', async () => {
    repository.findById = vi.fn().mockResolvedValue(null);

    await expect(service.findById('auto-1', { userId: 'user-2' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
