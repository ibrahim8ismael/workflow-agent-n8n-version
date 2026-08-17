import { describe, expect, it, vi } from 'vitest';
import { ChannelsInboundService } from './channels-inbound.service';

describe('ChannelsInboundService', () => {
  const mockRepo = {
    findByType: vi.fn(),
  };

  const mockConversations = {
    findMany: vi.fn(),
    create: vi.fn(),
    addMessage: vi.fn(),
  };

  const mockAgents = {
    findById: vi.fn(),
  };

  const mockJaafarRuntime = {
    start: vi.fn(),
  };

  it('processes incoming channel message and triggers Jaafar AI employee run', async () => {
    mockRepo.findByType.mockResolvedValue([
      { id: 'chan_1', agentId: 'agent_jaafar', type: 'WHATSAPP' },
    ]);
    mockAgents.findById.mockResolvedValue({ id: 'agent_jaafar', organizationId: 'org_1' });
    mockConversations.findMany.mockResolvedValue([]);
    mockConversations.create.mockResolvedValue({ id: 'conv_1' });
    mockConversations.addMessage.mockResolvedValue({ id: 'msg_1' });
    mockJaafarRuntime.start.mockResolvedValue({
      runId: 'run_1',
      status: 'COMPLETED',
      response: 'Hello, your subscription is active!',
    });

    const service = new ChannelsInboundService(
      mockRepo as never,
      mockConversations as never,
      mockAgents as never,
      mockJaafarRuntime as never,
    );

    const result = await service.processInboundMessage({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'wa_user_998',
      message: {
        type: 'text',
        content: 'Check subscription',
      },
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Hello, your subscription is active!');
    expect(result.conversationId).toBe('conv_1');
    expect(result.runId).toBe('run_1');

    expect(mockConversations.addMessage).toHaveBeenCalledWith(
      'conv_1',
      expect.objectContaining({
        role: 'user',
        content: 'Check subscription',
      }),
    );
    expect(mockConversations.addMessage).toHaveBeenCalledWith(
      'conv_1',
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello, your subscription is active!',
      }),
    );
  });
});
