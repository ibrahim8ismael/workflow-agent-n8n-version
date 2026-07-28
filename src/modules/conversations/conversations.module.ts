import { Module } from '@nestjs/common';
import { ConversationsController } from './controllers/conversations.controller';
import { ConversationsService } from './services/conversations.service';
import { ConversationsRepository } from './repositories/conversations.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsRepository],
  exports: [ConversationsService],
})
export class ConversationsModule {}
