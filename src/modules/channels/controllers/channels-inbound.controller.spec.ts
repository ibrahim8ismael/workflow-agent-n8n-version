import { describe, expect, it, vi } from 'vitest';
import { ChannelsInboundController } from './channels-inbound.controller';

describe('ChannelsInboundController', () => {
  it('delegates parsed message to inbound service', async () => {
    const mockInboundService = {
      processInboundMessage: vi.fn().mockResolvedValue({
        success: true,
        conversationId: 'conv_123',
        response: 'Your order #101 is shipped.',
      }),
    };

    const controller = new ChannelsInboundController(mockInboundService as never);
    const result = await controller.handleInbound({
      channelType: 'WHATSAPP',
      channelIdentifier: '+14155552671',
      externalUserId: 'user_456',
      message: {
        type: 'text',
        content: 'Where is my order #101?',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data.response).toBe('Your order #101 is shipped.');
    expect(mockInboundService.processInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'WHATSAPP',
        externalUserId: 'user_456',
      }),
    );
  });
});
