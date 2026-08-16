import { Injectable, NotFoundException } from '@nestjs/common';
import { Conversation, Message } from '@prisma/client';
import { ConversationsRepository } from '../repositories/conversations.repository';

@Injectable()
export class ConversationsService {
  constructor(private readonly conversationsRepository: ConversationsRepository) {}

  async create(dto: {
    title?: string;
    agentId: string;
    userId?: string;
    organizationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation> {
    return this.conversationsRepository.create({
      title: dto.title?.trim() || 'New chat',
      agent: { connect: { id: dto.agentId } },
      ...(dto.userId ? { user: { connect: { id: dto.userId } } } : {}),
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
      metadata: dto.metadata as never,
      status: 'ACTIVE',
    } as never);
  }

  async updateTitle(
    id: string,
    title: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    await this.findById(id, scope);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('Conversation title cannot be empty');
    return this.conversationsRepository.update(id, { title: normalizedTitle });
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    const conversation = await this.findById(id, scope);
    const currentMetadata = (conversation.metadata as Record<string, unknown> | null) ?? {};
    return this.conversationsRepository.update(id, {
      metadata: { ...currentMetadata, ...metadata } as never,
    });
  }

  async titleFromFirstMessage(id: string, message: string): Promise<Conversation> {
    const conversation = await this.findById(id);
    if (conversation.title && conversation.title !== 'New chat') return conversation;

    const normalizedMessage = message.replace(/\s+/g, ' ').trim();
    const title =
      normalizedMessage.length > 60
        ? `${normalizedMessage.slice(0, 57).trimEnd()}...`
        : normalizedMessage;
    return title ? this.conversationsRepository.update(id, { title }) : conversation;
  }

  async findById(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    const conversation = await this.conversationsRepository.findById(id, scope);
    if (!conversation) throw new NotFoundException(`Conversation with id "${id}" not found`);
    return conversation;
  }

  async findByIdInScope(
    id: string,
    scope: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    return this.findById(id, scope);
  }

  async findMany(params?: {
    agentId?: string;
    userId?: string;
    organizationId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<Conversation[]> {
    const where: Record<string, unknown> = {};
    if (params?.agentId) where.agentId = params.agentId;
    if (params?.userId) where.userId = params.userId;
    if (params?.organizationId) where.organizationId = params.organizationId;
    if (params?.status) where.status = params.status;

    return this.conversationsRepository.findMany({
      where: where as never,
      orderBy: { updatedAt: 'desc' },
      skip: params?.skip,
      take: params?.take,
    });
  }

  async addMessage(
    conversationId: string,
    message: { role: string; content: string; metadata?: Record<string, unknown> },
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Message> {
    await this.findById(conversationId, scope);
    const createdMessage = await this.conversationsRepository.addMessage({
      conversation: { connect: { id: conversationId } },
      role: message.role,
      content: message.content,
      metadata: message.metadata as never,
    } as never);
    await this.conversationsRepository.update(conversationId, { updatedAt: new Date() });
    return createdMessage;
  }

  async getMessages(
    conversationId: string,
    options?: { skip?: number; take?: number },
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Message[]> {
    await this.findById(conversationId, scope);
    return this.conversationsRepository.getMessages(conversationId, options);
  }

  async resolve(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    await this.findById(id, scope);
    return this.conversationsRepository.update(id, { status: 'RESOLVED' });
  }

  async archive(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    await this.findById(id, scope);
    return this.conversationsRepository.update(id, { status: 'ARCHIVED' });
  }

  async softDelete(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Conversation> {
    await this.findById(id, scope);
    return this.conversationsRepository.softDelete(id);
  }
}
