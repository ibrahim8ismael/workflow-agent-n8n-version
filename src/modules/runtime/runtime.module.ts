import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LLMRuntimeModule } from '../../infrastructure/llm-runtime/llm-runtime.module';
import { AgentsModule } from '../agents/agents.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { PlannerModule } from '../planner/planner.module';
import { RunsModule } from '../runs/runs.module';
import { SkillsModule } from '../skills/skills.module';
import { ConversationRuntimeService } from './conversation/conversation-runtime.service';
import { EmployeeDesignRuntimeService } from './employee-design/employee-design-runtime.service';
import { RuntimeRepository } from './repositories/runtime.repository';
import { RuntimeController } from './runtime.controller';
import { RuntimeRouterService } from './runtime-router.service';
import { ContextBuilderService } from './services/context-builder.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeCacheService } from './shared/runtime-cache.service';
import { SkillEmployeeRuntimeService } from './skill/skill-employee-runtime.service';

@Module({
  imports: [
    DatabaseModule,
    LLMRuntimeModule,
    AgentsModule,
    PlannerModule,
    RunsModule,
    ConversationsModule,
    KnowledgeModule,
    MemoryModule,
    SkillsModule,
  ],
  controllers: [RuntimeController],
  providers: [
    RuntimeService,
    RuntimeRouterService,
    ConversationRuntimeService,
    EmployeeDesignRuntimeService,
    SkillEmployeeRuntimeService,
    RuntimeCacheService,
    ContextBuilderService,
    RuntimeRepository,
  ],
  exports: [RuntimeService, RuntimeRouterService],
})
export class RuntimeModule {}
