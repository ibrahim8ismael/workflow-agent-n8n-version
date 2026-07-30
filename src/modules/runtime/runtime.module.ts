import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AgentsModule } from '../agents/agents.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MemoryModule } from '../memory/memory.module';
import { PlannerModule } from '../planner/planner.module';
import { RunsModule } from '../runs/runs.module';
import { SkillsModule } from '../skills/skills.module';
import { RuntimeRepository } from './repositories/runtime.repository';
import { ContextBuilderService } from './services/context-builder.service';
import { RuntimeService } from './services/runtime.service';
import { ToolRegistryService } from './services/tool-registry.service';

@Module({
  imports: [
    DatabaseModule,
    AgentsModule,
    PlannerModule,
    RunsModule,
    ConversationsModule,
    MemoryModule,
    SkillsModule,
  ],
  providers: [RuntimeService, ContextBuilderService, ToolRegistryService, RuntimeRepository],
  exports: [RuntimeService],
})
export class RuntimeModule {}
