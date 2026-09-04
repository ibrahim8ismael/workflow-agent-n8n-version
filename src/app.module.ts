import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { validateConfig } from './config/validation';
import { DatabaseModule } from './database/database.module';
import { AIAdapterModule } from './infrastructure/ai-adapter/ai-adapter.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { EmailModule } from './infrastructure/email/email.module';
import { HttpModule } from './infrastructure/http/http.module';
import { LLMRuntimeModule } from './infrastructure/llm-runtime/llm-runtime.module';
import { MonitoringModule } from './infrastructure/monitoring/monitoring.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { LoggerModule } from './logger/logger.module';
import { AdminModule } from './modules/admin/admin.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuthModule } from './modules/auth/auth.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { HealthModule } from './modules/health/health.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MemoryModule } from './modules/memory/memory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlannerModule } from './modules/planner/planner.module';
import { RunsModule } from './modules/runs/runs.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { UsersModule } from './modules/users/users.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateConfig }),
    DatabaseModule,
    LoggerModule,
    CacheModule,
    QueueModule,
    EmailModule,
    StorageModule,
    MonitoringModule,
    RealtimeModule,
    HttpModule,
    CommonModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    AgentsModule,
    PlannerModule,
    RunsModule,
    AIAdapterModule,
    LLMRuntimeModule,
    ConversationsModule,
    KnowledgeModule,
    MemoryModule,
    BillingModule,
    AdminModule,
    RuntimeModule,
    ChannelsModule,
    IntegrationsModule,
    AutomationsModule,
    HealthModule,
    NotificationsModule,
    SharedModule,
  ],
})
export class AppModule {}
