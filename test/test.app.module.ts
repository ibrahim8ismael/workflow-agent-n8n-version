import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../src/common/common.module';
import { DatabaseModule } from '../src/database/database.module';
import { CacheModule } from '../src/infrastructure/cache/cache.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { LoggerModule } from '../src/logger/logger.module';
import { AdminModule } from '../src/modules/admin/admin.module';
import { AgentsModule } from '../src/modules/agents/agents.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { BillingModule } from '../src/modules/billing/billing.module';
import { ChannelsModule } from '../src/modules/channels/channels.module';
import { ConversationsModule } from '../src/modules/conversations/conversations.module';
import { IntegrationsModule } from '../src/modules/integrations/integrations.module';
import { KnowledgeModule } from '../src/modules/knowledge/knowledge.module';
import { MemoryModule } from '../src/modules/memory/memory.module';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { OrganizationsModule } from '../src/modules/organizations/organizations.module';
import { RuntimeModule } from '../src/modules/runtime/runtime.module';
import { UsersModule } from '../src/modules/users/users.module';
import { SharedModule } from '../src/shared/shared.module';

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
export class TestAppModule {}
