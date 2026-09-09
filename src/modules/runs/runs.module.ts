import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AgentRunService } from './agent-run.service';
import { RunsRepository } from './runs.repository';
import { RunsService } from './runs.service';

@Module({
  imports: [DatabaseModule],
  providers: [RunsService, RunsRepository, AgentRunService],
  exports: [RunsService, AgentRunService],
})
export class RunsModule {}
