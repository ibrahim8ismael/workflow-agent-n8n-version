import { Injectable } from '@nestjs/common';
import { Conversation, Message, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class ConversationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.ConversationCreateInput): Promise<Conversation> {
    return this.db.conversation.create({ data });
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.db.conversation.findFirst({
      where: { id, deletedAt: null },
      include: { messages: { orderBy: { createdAt: 'asc' }, where: { deletedAt: null } } },
    });
  }

  async findMany(params?: {
    where?: Prisma.ConversationWhereInput;
    orderBy?: Prisma.ConversationOrderByWithRelationInput;
    skip?: number;
    take?: number;
  }): Promise<Conversation[]> {
    return this.db.conversation.findMany({
      where: { ...params?.where, deletedAt: null },
      orderBy: params?.orderBy,
      skip: params?.skip,
      take: params?.take,
    });
  }

  async update(id: string, data: Prisma.ConversationUpdateInput): Promise<Conversation> {
    return this.db.conversation.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Conversation> {
    return this.db.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addMessage(data: Prisma.MessageCreateInput): Promise<Message> {
    return this.db.message.create({ data });
  }

  async getMessages(
    conversationId: string,
    options?: { skip?: number; take?: number },
  ): Promise<Message[]> {
    return this.db.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      skip: options?.skip,
      take: options?.take,
    });
  }

  async countByAgent(agentId: string): Promise<number> {
    return this.db.conversation.count({
      where: { agentId, deletedAt: null },
    });
  }
}
