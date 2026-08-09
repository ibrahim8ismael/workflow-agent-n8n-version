import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { KnowledgeRepository } from './repositories/knowledge.repository';
import { KnowledgeService } from './services/knowledge.service';

@Module({
  imports: [DatabaseModule],
  providers: [KnowledgeService, KnowledgeRepository],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
