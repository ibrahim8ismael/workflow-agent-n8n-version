import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { ChannelsService } from '../services/channels.service';

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  async create(@Body() dto: { agentId: string; type: string; name?: string }): Promise<Channel> {
    return this.channelsService.create(dto as never);
  }

  @Get('agent/:agentId')
  async findByAgent(@Param('agentId') agentId: string): Promise<Channel[]> {
    return this.channelsService.findByAgent(agentId);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Channel> {
    return this.channelsService.findById(id);
  }

  @Get(':agentId/check/:type')
  async checkAvailability(
    @Param('agentId') agentId: string,
    @Param('type') type: string,
  ): Promise<{ available: boolean }> {
    const available = await this.channelsService.isAvailable(agentId, type);
    return { available };
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<Channel> {
    return this.channelsService.softDelete(id);
  }
}
