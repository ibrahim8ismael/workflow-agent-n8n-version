import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import type { JaafarRuntimeService } from '../../runtime/services/jaafar-runtime.service';
import type { InboundChannelMessageDto } from '../dto/inbound-channel-message.dto';
import { ChannelsRepository } from '../repositories/channels.repository';

export interface InboundProcessingResult {
  success: boolean;
  conversationId: string;
  runId?: string;
  response?: string;
  channelType: string;
  externalConversationId?: string;
}

@Injectable()
export class ChannelsInboundService {
  private readonly logger = new Logger(ChannelsInboundService.name);

  constructor(
    private readonly channelsRepository: ChannelsRepository,
    private readonly conversationsService: ConversationsService,
    @Optional() private readonly agentsService?: AgentsService,
    @Optional() private readonly jaafarRuntime?: JaafarRuntimeService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private getJaafarRuntime(): JaafarRuntimeService | undefined {
    if (this.jaafarRuntime) return this.jaafarRuntime;
    if (!this.moduleRef) return undefined;
    try {
      // Dynamic resolution avoiding module import cycle
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { JaafarRuntimeService } = require('../../runtime/services/jaafar-runtime.service');
      return this.moduleRef.get(JaafarRuntimeService, { strict: false });
    } catch {
      return undefined;
    }
  }

  async processInboundMessage(dto: InboundChannelMessageDto): Promise<InboundProcessingResult> {
    this.logger.log({
      event: 'channel.inbound_received',
      channelType: dto.channelType,
      externalUserId: dto.externalUserId,
      channelIdentifier: dto.channelIdentifier,
    });

    const agentId = await this.resolveTargetAgent(dto);
    const agent = this.agentsService ? await this.agentsService.findById(agentId) : null;

    const conversation = await this.resolveOrCreateConversation({
      agentId,
      dto,
      organizationId: agent?.organizationId ?? undefined,
      userId: agent?.userId ?? undefined,
    });

    // 1. Record incoming user message
    await this.conversationsService.addMessage(conversation.id, {
      role: 'user',
      content: dto.message.content,
      metadata: {
        channelType: dto.channelType,
        channelIdentifier: dto.channelIdentifier,
        externalMessageId: dto.externalMessageId,
        externalUserId: dto.externalUserId,
        sender: dto.sender,
        attachments: dto.message.attachments,
      },
    });

    // 2. Execute AI Employee Run if JaafarRuntime is available
    const runtime = this.getJaafarRuntime();
    if (runtime) {
      const runResult = await runtime.start({
        agentId,
        conversationId: conversation.id,
        userMessage: dto.message.content,
        userId: agent?.userId ?? undefined,
        organizationId: agent?.organizationId ?? undefined,
        mode: 'conversation',
      });

      const responseText = runResult.response ?? '';

      // 3. Record assistant message in conversation history
      if (responseText) {
        await this.conversationsService.addMessage(conversation.id, {
          role: 'assistant',
          content: responseText,
          metadata: {
            runId: runResult.runId,
            channelType: dto.channelType,
          },
        });
      }

      return {
        success: runResult.status === 'COMPLETED' || runResult.status === 'WAITING',
        conversationId: conversation.id,
        runId: runResult.runId,
        response: responseText,
        channelType: dto.channelType,
        externalConversationId: dto.externalConversationId,
      };
    }

    return {
      success: true,
      conversationId: conversation.id,
      channelType: dto.channelType,
      externalConversationId: dto.externalConversationId,
    };
  }

  private async resolveTargetAgent(dto: InboundChannelMessageDto): Promise<string> {
    if (dto.agentId) return dto.agentId;

    const channels = await this.channelsRepository.findByType(dto.channelType);
    if (channels.length === 0) {
      throw new NotFoundException(`No active agent found for channel type "${dto.channelType}"`);
    }

    const matchedChannel = channels[0];
    if (!matchedChannel) {
      throw new NotFoundException(`No active agent found for channel type "${dto.channelType}"`);
    }

    return matchedChannel.agentId;
  }

  private async resolveOrCreateConversation(params: {
    agentId: string;
    dto: InboundChannelMessageDto;
    organizationId?: string;
    userId?: string;
  }) {
    const { agentId, dto, organizationId, userId } = params;
    const externalConvId = dto.externalConversationId ?? dto.externalUserId;

    const existingList = await this.conversationsService.findMany({
      agentId,
      organizationId,
      userId,
      status: 'ACTIVE',
      take: 20,
    });

    const existing = existingList.find((conv) => {
      const meta = conv.metadata as Record<string, unknown> | null;
      return (
        meta?.channelType === dto.channelType && meta?.externalConversationId === externalConvId
      );
    });

    if (existing) {
      return existing;
    }

    return this.conversationsService.create({
      agentId,
      title: `${dto.channelType} - ${dto.sender?.name ?? dto.externalUserId}`,
      userId,
      organizationId,
      metadata: {
        channelType: dto.channelType,
        channelIdentifier: dto.channelIdentifier,
        externalConversationId: externalConvId,
        externalUserId: dto.externalUserId,
        sender: dto.sender,
      },
    });
  }
}
