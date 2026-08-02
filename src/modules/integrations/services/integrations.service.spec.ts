import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  const integration = (overrides: Record<string, unknown> = {}) => ({
    id: 'integration-1',
    name: 'HubSpot',
    provider: 'hubspot',
    category: 'CRM',
    status: 'CONNECTED',
    ...overrides,
  });

  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByOrganization: vi.fn(),
    checkAvailability: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as IntegrationsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.create).mockResolvedValue(integration() as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(integration() as never);
    vi.mocked(mockRepo.findByOrganization).mockResolvedValue([integration()] as never);
    vi.mocked(mockRepo.checkAvailability).mockResolvedValue(true as never);
    vi.mocked(mockRepo.softDelete).mockResolvedValue(integration() as never);
    service = new IntegrationsService(mockRepo);
  });

  it('should create a DISCONNECTED integration with an organization connection', async () => {
    await service.create({
      name: 'HubSpot',
      provider: 'hubspot',
      category: 'CRM',
      organizationId: 'org-1',
    });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'HubSpot',
        provider: 'hubspot',
        category: 'CRM',
        status: 'DISCONNECTED',
        organization: { connect: { id: 'org-1' } },
      }),
    );
  });

  it('should return the integration when found', async () => {
    const result = await service.findById('integration-1');

    expect(result.id).toBe('integration-1');
  });

  it('should throw when the integration is missing', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('should list integrations by organization', async () => {
    await service.findByOrganization('org-1');

    expect(mockRepo.findByOrganization).toHaveBeenCalledWith('org-1');
  });

  it('should report provider availability', async () => {
    const result = await service.isConnected('org-1', 'hubspot');

    expect(mockRepo.checkAvailability).toHaveBeenCalledWith('org-1', 'hubspot');
    expect(result).toBe(true);
  });

  it('should soft delete an existing integration', async () => {
    await service.softDelete('integration-1');

    expect(mockRepo.softDelete).toHaveBeenCalledWith('integration-1');
  });
});
