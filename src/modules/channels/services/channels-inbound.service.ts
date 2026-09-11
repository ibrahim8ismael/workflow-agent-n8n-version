import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AgentsService } from '../../agents/services/agents.service';
import { ConversationsService } from '../../conversations/services/conversations.service';
import { RunsService } from '../../runs/runs.service';
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
    @Optional() private readonly runs?: RunsService,
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

    // Webhook dedupe: WhatsApp/Slack-style retries redeliver the same
    // external message. Without this check every redelivery created a
    // duplicate run, duplicate LLM spend, and a duplicate assistant reply.
    if (dto.externalMessageId && this.runs) {
      try {
        const existingRun = await this.runs.findByChannelMessage(
          conversation.id,
          dto.externalMessageId,
        );
        if (existingRun) {
          this.logger.log({
            event: 'channel.inbound_duplicate_ignored',
            channelType: dto.channelType,
            externalMessageId: dto.externalMessageId,
            runId: existingRun.id,
          });
          return {
            success: true,
            conversationId: conversation.id,
            runId: existingRun.id,
            response: (existingRun as { result?: string | null }).result ?? undefined,
            channelType: dto.channelType,
            externalConversationId: dto.externalConversationId,
          };
        }
      } catch {
        /* dedupe is best-effort — never block the webhook */
      }
    }

    const runtime = this.getJaafarRuntime();
    if (runtime) {
      const runResult = await runtime.start({
        agentId,
        conversationId: conversation.id,
        userMessage: dto.message.content,
        userId: agent?.userId ?? undefined,
        organizationId: agent?.organizationId ?? undefined,
        mode: 'conversation',
        // Turns are persisted by the graphs (single owner) — the channel no
        // longer writes messages, so history holds exactly one user turn and
        // one assistant turn per exchange. The externalMessageId rides on
        // the run metadata as the dedup anchor.
        ...(dto.externalMessageId ? { channelMessageId: dto.externalMessageId } : {}),
      });

      return {
        success: runResult.status === 'COMPLETED' || runResult.status === 'WAITING',
        conversationId: conversation.id,
        runId: runResult.runId,
        response: runResult.response ?? '',
        channelType: dto.channelType,
        externalConversationId: dto.externalConversationId,
      };
    }

    // No runtime available — record the user message so the exchange is not
    // silently lost (the graph persistence path does not exist here).
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

    if (externalConvId) {
      const existing = await this.conversationsService.findByChannelThread(
        agentId,
        dto.channelType,
        externalConvId,
      );
      if (existing) return existing;
    }

    try {
      return await this.conversationsService.create({
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
        ...(externalConvId
          ? { channelType: dto.channelType, externalConversationId: externalConvId }
          : {}),
      });
    } catch (error) {
      // Two concurrent deliveries for the same external thread race on the
      // conversation unique constraint — return the winner instead of
      // failing the webhook.
      if (externalConvId && this.isUniqueConstraintError(error)) {
        const existing = await this.conversationsService.findByChannelThread(
          agentId,
          dto.channelType,
          externalConvId,
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
    );
  }
}
