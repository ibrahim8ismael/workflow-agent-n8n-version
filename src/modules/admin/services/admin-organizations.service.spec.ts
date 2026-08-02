import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOrganizationsRepository } from '../repositories/admin-organizations.repository';
import { AdminOrganizationsService } from './admin-organizations.service';

describe('AdminOrganizationsService', () => {
  let service: AdminOrganizationsService;

  const org = (overrides: Record<string, unknown> = {}) => ({
    id: 'org-1',
    name: 'Acme',
    status: 'ACTIVE',
    ...overrides,
  });

  const mockRepo = {
    findAll: vi.fn(),
    findById: vi.fn(),
    suspend: vi.fn(),
    reactivate: vi.fn(),
    count: vi.fn(),
  } as unknown as AdminOrganizationsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.findAll).mockResolvedValue([org()] as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(org() as never);
    vi.mocked(mockRepo.suspend).mockResolvedValue(org({ status: 'SUSPENDED' }) as never);
    vi.mocked(mockRepo.reactivate).mockResolvedValue(org() as never);
    vi.mocked(mockRepo.count).mockResolvedValue(5 as never);
    service = new AdminOrganizationsService(mockRepo);
  });

  it('should list organizations with pagination', async () => {
    await service.findAll(10, 5);

    expect(mockRepo.findAll).toHaveBeenCalledWith(10, 5);
  });

  it('should return the organization when found', async () => {
    const result = await service.findById('org-1');

    expect(result.id).toBe('org-1');
  });

  it('should throw when the organization is missing', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('should suspend an existing organization', async () => {
    const result = await service.suspend('org-1');

    expect(mockRepo.suspend).toHaveBeenCalledWith('org-1');
    expect(result.id).toBe('org-1');
  });

  it('should throw when suspending a missing organization', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    await expect(service.suspend('missing')).rejects.toThrow(NotFoundException);
  });

  it('should reactivate an organization', async () => {
    await service.reactivate('org-1');

    expect(mockRepo.reactivate).toHaveBeenCalledWith('org-1');
  });

  it('should return org stats', async () => {
    const result = await service.getStats();

    expect(result).toEqual({ total: 5 });
  });
});
