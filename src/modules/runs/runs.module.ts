import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RunsRepository } from './runs.repository';
import { RunsService } from './runs.service';

@Module({
  imports: [DatabaseModule],
  providers: [RunsService, RunsRepository],
  exports: [RunsService],
})
export class RunsModule {}
