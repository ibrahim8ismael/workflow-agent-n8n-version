import { Module } from '@nestjs/common';
import { ChannelsController } from './controllers/channels.controller';
import { ChannelsService } from './services/channels.service';
import { ChannelsRepository } from './repositories/channels.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelsRepository],
  exports: [ChannelsService],
})
export class ChannelsModule {}
