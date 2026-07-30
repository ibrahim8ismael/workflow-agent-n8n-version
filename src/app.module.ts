import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AIAdapterModule } from './infrastructure/ai-adapter/ai-adapter.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { LoggerModule } from './logger/logger.module';
import { AdminModule } from './modules/admin/admin.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MemoryModule } from './modules/memory/memory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlannerModule } from './modules/planner/planner.module';
import { RunsModule } from './modules/runs/runs.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { SkillsModule } from './modules/skills/skills.module';
import { UsersModule } from './modules/users/users.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    LoggerModule,
    CacheModule,
    QueueModule,
    CommonModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    AgentsModule,
    SkillsModule,
    PlannerModule,
    RunsModule,
    AIAdapterModule,
    ConversationsModule,
    KnowledgeModule,
    MemoryModule,
    BillingModule,
    AdminModule,
    RuntimeModule,
    ChannelsModule,
    IntegrationsModule,
    NotificationsModule,
    SharedModule,
  ],
})
export class AppModule {}
