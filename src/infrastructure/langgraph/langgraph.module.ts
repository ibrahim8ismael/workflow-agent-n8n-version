import { Module } from '@nestjs/common';
import { LangGraphMemoryCheckpointerService } from './langgraph-memory-checkpointer.service';
import { LangGraphPostgresCheckpointerService } from './langgraph-postgres-checkpointer.service';

@Module({
  providers: [LangGraphMemoryCheckpointerService, LangGraphPostgresCheckpointerService],
  exports: [LangGraphMemoryCheckpointerService, LangGraphPostgresCheckpointerService],
})
export class LangGraphModule {}
