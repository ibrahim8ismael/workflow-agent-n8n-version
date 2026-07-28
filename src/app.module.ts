import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './logger/logger.module';
import { CacheModule } from './cache/cache.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { EmailModule } from './email/email.module';
import { AiModule } from './ai/ai.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HttpModule } from './http/http.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AgentsModule } from './modules/agents/agents.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MemoryModule } from './modules/memory/memory.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { BillingModule } from './modules/billing/billing.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    LoggerModule,
    CacheModule,
    QueueModule,
    StorageModule,
    EmailModule,
    AiModule,
    RealtimeModule,
    HttpModule,
    CommonModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    AgentsModule,
    ConversationsModule,
    MemoryModule,
    KnowledgeModule,
    RuntimeModule,
    BillingModule,
    ChannelsModule,
    IntegrationsModule,
    NotificationsModule,
    MonitoringModule,
    SharedModule,
  ],
})
export class AppModule {}
