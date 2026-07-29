import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './logger/logger.module';
import { CommonModule } from './common/common.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AgentsModule } from './modules/agents/agents.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MemoryModule } from './modules/memory/memory.module';
import { BillingModule } from './modules/billing/billing.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
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
