import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ConversationsController } from './controllers/conversations.controller';
import { ConversationsRepository } from './repositories/conversations.repository';
import { ConversationsService } from './services/conversations.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsRepository],
  exports: [ConversationsService],
})
export class ConversationsModule {}
