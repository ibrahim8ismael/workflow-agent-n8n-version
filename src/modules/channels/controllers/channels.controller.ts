import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../auth/guards/auth.guard';
import { ChannelsService } from '../services/channels.service';

@Controller('channels')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  async create(@Body() dto: { agentId: string; type: string; name?: string }): Promise<Channel> {
    return this.channelsService.create(dto as never);
  }

  @Get('agent/:agentId')
  async findByAgent(
    @Param('agentId') agentId: string,
    @CurrentUser() user: ChannelUser,
  ): Promise<Channel[]> {
    return this.channelsService.findByAgent(agentId, this.scopeFor(user));
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: ChannelUser): Promise<Channel> {
    return this.channelsService.findById(id, this.scopeFor(user));
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
  async remove(@Param('id') id: string, @CurrentUser() user: ChannelUser): Promise<Channel> {
    return this.channelsService.softDelete(id, this.scopeFor(user));
  }

  private scopeFor(user: ChannelUser): { userId: string; organizationId?: string } {
    return {
      userId: user.id,
      organizationId: user.activeContext === 'organization' ? user.organizationId : undefined,
    };
  }
}

type ChannelUser = { id: string; activeContext?: string; organizationId?: string };
