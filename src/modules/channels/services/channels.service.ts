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

  async findById(id: string): Promise<Channel> {
    const channel = await this.channelsRepository.findById(id);
    if (!channel) throw new NotFoundException(`Channel with id "${id}" not found`);
    return channel;
  }

  async findByAgent(agentId: string): Promise<Channel[]> {
    return this.channelsRepository.findByAgent(agentId);
  }

  async isAvailable(agentId: string, type: string): Promise<boolean> {
    return this.channelsRepository.isAvailable(agentId, type);
  }

  async softDelete(id: string): Promise<Channel> {
    await this.findById(id);
    return this.channelsRepository.softDelete(id);
  }
}
