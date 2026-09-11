import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AgentsModule } from '../agents/agents.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { RunsModule } from '../runs/runs.module';
import { ChannelsController } from './controllers/channels.controller';
import { ChannelsInboundController } from './controllers/channels-inbound.controller';
import { ChannelsRepository } from './repositories/channels.repository';
import { ChannelsService } from './services/channels.service';
import { ChannelsInboundService } from './services/channels-inbound.service';

@Module({
  imports: [DatabaseModule, ConversationsModule, AgentsModule, RunsModule],
  controllers: [ChannelsController, ChannelsInboundController],
  providers: [ChannelsService, ChannelsInboundService, ChannelsRepository],
  exports: [ChannelsService, ChannelsInboundService],
})
export class ChannelsModule {}
