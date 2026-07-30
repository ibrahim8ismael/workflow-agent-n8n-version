import { Injectable, NotFoundException } from '@nestjs/common';
import type { Conversation, Message } from '@prisma/client';
import type { ConversationsRepository } from '../repositories/conversations.repository';

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
      title: dto.title,
      agent: { connect: { id: dto.agentId } },
      ...(dto.userId ? { user: { connect: { id: dto.userId } } } : {}),
      ...(dto.organizationId ? { organization: { connect: { id: dto.organizationId } } } : {}),
      metadata: dto.metadata as never,
      status: 'ACTIVE',
    } as never);
  }

  async findById(id: string): Promise<Conversation> {
    const conversation = await this.conversationsRepository.findById(id);
    if (!conversation) throw new NotFoundException(`Conversation with id "${id}" not found`);
    return conversation;
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
  ): Promise<Message> {
    await this.findById(conversationId);
    return this.conversationsRepository.addMessage({
      conversation: { connect: { id: conversationId } },
      role: message.role,
      content: message.content,
      metadata: message.metadata as never,
    } as never);
  }

  async getMessages(
    conversationId: string,
    options?: { skip?: number; take?: number },
  ): Promise<Message[]> {
    await this.findById(conversationId);
    return this.conversationsRepository.getMessages(conversationId, options);
  }

  async resolve(id: string): Promise<Conversation> {
    await this.findById(id);
    return this.conversationsRepository.update(id, { status: 'RESOLVED' });
  }

  async archive(id: string): Promise<Conversation> {
    await this.findById(id);
    return this.conversationsRepository.update(id, { status: 'ARCHIVED' });
  }

  async softDelete(id: string): Promise<Conversation> {
    await this.findById(id);
    return this.conversationsRepository.softDelete(id);
  }
}
