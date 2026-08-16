import { Injectable, NotFoundException } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { ChannelsRepository } from '../repositories/channels.repository';

@Injectable()
export class ChannelsService {
  constructor(private readonly channelsRepository: ChannelsRepository) {}

  async create(dto: CreateChannelDto): Promise<Channel> {
    return this.channelsRepository.create({
      agent: { connect: { id: dto.agentId } },
      type: dto.type as never,
      name: dto.name,
      status: 'ACTIVE',
    } as never);
  }

  async findById(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Channel> {
    const channel = scope
      ? await this.channelsRepository.findById(id, scope)
      : await this.channelsRepository.findById(id);
    if (!channel) throw new NotFoundException(`Channel with id "${id}" not found`);
    return channel;
  }

  async findByAgent(
    agentId: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Channel[]> {
    return scope
      ? this.channelsRepository.findByAgent(agentId, scope)
      : this.channelsRepository.findByAgent(agentId);
  }

  async isAvailable(agentId: string, type: string): Promise<boolean> {
    return this.channelsRepository.isAvailable(agentId, type);
  }

  async softDelete(
    id: string,
    scope?: { userId?: string; organizationId?: string },
  ): Promise<Channel> {
    await this.findById(id, scope);
    return this.channelsRepository.softDelete(id);
  }
}
