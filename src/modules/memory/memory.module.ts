import { Module } from '@nestjs/common';
import { MemoryController } from './controllers/memory.controller';
import { MemoryService } from './services/memory.service';
import { MemoryRepository } from './repositories/memory.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [MemoryController],
  providers: [MemoryService, MemoryRepository],
  exports: [MemoryService],
})
export class MemoryModule {}
