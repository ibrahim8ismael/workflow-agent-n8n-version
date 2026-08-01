import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AgentsController } from './controllers/agents.controller';
import { AgentsRepository } from './repositories/agents.repository';
import { AgentsService } from './services/agents.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentsRepository],
  exports: [AgentsService],
})
export class AgentsModule {}
