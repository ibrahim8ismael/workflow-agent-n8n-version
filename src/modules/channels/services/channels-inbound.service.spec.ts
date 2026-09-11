import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelsInboundService } from './channels-inbound.service';

describe('ChannelsInboundService', () => {
  const mockRepo = { findByType: vi.fn() };
  const mockConversations = {
    findByChannelThread: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    addMessage: vi.fn(),
  };
  const mockAgents = { findById: vi.fn() };
  const mockJaafarRuntime = { start: vi.fn() };
  const mockRuns = { findByChannelMessage: vi.fn() };

  const service = () =>
    new ChannelsInboundService(
      mockRepo as never,
      mockConversations as never,
      mockAgents as never,
      mockJaafarRuntime as never,
      undefined,
      mockRuns as never,
    );

  beforeEach(() => {
    vi.resetAllMocks();
    mockRepo.findByType.mockResolvedValue([
      { id: 'chan_1', agentId: 'agent_jaafar', type: 'WHATSAPP' },
    ]);
    mockAgents.findById.mockResolvedValue({ id: 'agent_jaafar', organizationId: 'org_1' });
    mockConversations.findByChannelThread.mockResolvedValue(null);
    mockConversations.create.mockResolvedValue({ id: 'conv_1' });
    mockRuns.findByChannelMessage.mockResolvedValue(null);
    mockJaafarRuntime.start.mockResolvedValue({
      runId: 'run_1',
      status: 'COMPLETED',
      response: 'Hello, your subscription is active!',
    });
  });

  it('processes incoming channel message and triggers Jaafar AI employee run', async () => {
    const result = await service().processInboundMessage({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'wa_user_998',
      message: { type: 'text', content: 'Check subscription' },
    });

    expect(result.success).toBe(true);
    expect(result.response).toBe('Hello, your subscription is active!');
    expect(result.conversationId).toBe('conv_1');
    expect(result.runId).toBe('run_1');
    // Single-owner persistence: the graphs write the turns — the channel
    // must not duplicate them.
    expect(mockConversations.addMessage).not.toHaveBeenCalled();
    // The conversation is created with channel identity columns.
    expect(mockConversations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'WHATSAPP',
        externalConversationId: 'wa_user_998',
      }),
    );
  });

  it('passes the external message id to the runtime as the dedup anchor', async () => {
    await service().processInboundMessage({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'wa_user_998',
      externalMessageId: 'wamid.fresh',
      message: { type: 'text', content: 'Check subscription' },
    });

    expect(mockRuns.findByChannelMessage).toHaveBeenCalledWith('conv_1', 'wamid.fresh');
    expect(mockJaafarRuntime.start).toHaveBeenCalledWith(
      expect.objectContaining({ channelMessageId: 'wamid.fresh' }),
    );
  });

  it('ignores a redelivered external message instead of creating a duplicate run', async () => {
    mockConversations.findByChannelThread.mockResolvedValue({ id: 'conv_1' });
    mockRuns.findByChannelMessage.mockResolvedValue({ id: 'run_1', result: 'Original answer' });

    const result = await service().processInboundMessage({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'wa_user_998',
      externalMessageId: 'wamid.123',
      message: { type: 'text', content: 'Check subscription' },
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBe('run_1');
    expect(result.response).toBe('Original answer');
    // No new run, no new conversation for the redelivery.
    expect(mockJaafarRuntime.start).not.toHaveBeenCalled();
    expect(mockConversations.create).not.toHaveBeenCalled();
  });

  it('reuses the existing conversation for the same external thread', async () => {
    mockConversations.findByChannelThread.mockResolvedValue({ id: 'conv_existing' });
    mockJaafarRuntime.start.mockResolvedValue({
      runId: 'run_2',
      status: 'COMPLETED',
      response: 'Continuing',
    });

    const result = await service().processInboundMessage({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'wa_user_998',
      message: { type: 'text', content: 'Another question' },
    });

    expect(result.conversationId).toBe('conv_existing');
    expect(mockConversations.create).not.toHaveBeenCalled();
  });
});
