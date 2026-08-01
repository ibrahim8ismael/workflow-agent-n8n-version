import { Injectable } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class ChannelsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.ChannelCreateInput): Promise<Channel> {
    return this.db.channel.create({ data });
  }

  async findById(id: string): Promise<Channel | null> {
    return this.db.channel.findFirst({
      where: { id, deletedAt: null },
      include: { configs: { where: { deletedAt: null } } },
    });
  }

  async findByAgent(agentId: string): Promise<Channel[]> {
    return this.db.channel.findMany({
      where: { agentId, deletedAt: null },
      include: { configs: { where: { deletedAt: null } } },
    });
  }

  async isAvailable(agentId: string, type: string): Promise<boolean> {
    const channel = await this.db.channel.findFirst({
      where: { agentId, type: type as never, status: 'ACTIVE', deletedAt: null },
    });
    return channel !== null;
  }

  async update(id: string, data: Prisma.ChannelUpdateInput): Promise<Channel> {
    return this.db.channel.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Channel> {
    return this.db.channel.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
