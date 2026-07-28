import { Module } from '@nestjs/common';
import { AgentsController } from './controllers/agents.controller';
import { AgentsService } from './services/agents.service';
import { AgentsRepository } from './repositories/agents.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentsRepository],
  exports: [AgentsService],
})
export class AgentsModule {}
