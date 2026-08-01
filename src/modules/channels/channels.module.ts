import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ChannelsController } from './controllers/channels.controller';
import { ChannelsRepository } from './repositories/channels.repository';
import { ChannelsService } from './services/channels.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ChannelsRepository],
  exports: [ChannelsService],
})
export class ChannelsModule {}
