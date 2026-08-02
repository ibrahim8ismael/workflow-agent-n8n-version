import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelsRepository } from '../repositories/channels.repository';
import { ChannelsService } from './channels.service';

describe('ChannelsService', () => {
  let service: ChannelsService;

  const channel = (overrides: Record<string, unknown> = {}) => ({
    id: 'channel-1',
    agentId: 'agent-1',
    type: 'WHATSAPP',
    name: 'Sales line',
    status: 'ACTIVE',
    ...overrides,
  });

  const mockRepo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByAgent: vi.fn(),
    isAvailable: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as ChannelsRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.create).mockResolvedValue(channel() as never);
    vi.mocked(mockRepo.findById).mockResolvedValue(channel() as never);
    vi.mocked(mockRepo.findByAgent).mockResolvedValue([channel()] as never);
    vi.mocked(mockRepo.isAvailable).mockResolvedValue(true as never);
    vi.mocked(mockRepo.softDelete).mockResolvedValue(channel() as never);
    service = new ChannelsService(mockRepo);
  });

  it('should create an ACTIVE channel connected to the agent', async () => {
    await service.create({ agentId: 'agent-1', type: 'WHATSAPP', name: 'Sales line' });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { connect: { id: 'agent-1' } },
        type: 'WHATSAPP',
        name: 'Sales line',
        status: 'ACTIVE',
      }),
    );
  });

  it('should return the channel when found', async () => {
    const result = await service.findById('channel-1');

    expect(result.id).toBe('channel-1');
  });

  it('should throw when the channel is missing', async () => {
    vi.mocked(mockRepo.findById).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('should list channels by agent', async () => {
    await service.findByAgent('agent-1');

    expect(mockRepo.findByAgent).toHaveBeenCalledWith('agent-1');
  });

  it('should report channel availability', async () => {
    const result = await service.isAvailable('agent-1', 'WHATSAPP');

    expect(mockRepo.isAvailable).toHaveBeenCalledWith('agent-1', 'WHATSAPP');
    expect(result).toBe(true);
  });

  it('should soft delete an existing channel', async () => {
    await service.softDelete('channel-1');

    expect(mockRepo.softDelete).toHaveBeenCalledWith('channel-1');
  });
});
