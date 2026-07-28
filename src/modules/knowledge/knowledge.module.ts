import { Module } from '@nestjs/common';
import { KnowledgeController } from './controllers/knowledge.controller';
import { KnowledgeService } from './services/knowledge.service';
import { KnowledgeRepository } from './repositories/knowledge.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeRepository],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
