import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MemoryController } from './controllers/memory.controller';
import { MemoryRepository } from './repositories/memory.repository';
import { MemoryService } from './services/memory.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryRepository],
  exports: [MemoryService],
})
export class MemoryModule {}
