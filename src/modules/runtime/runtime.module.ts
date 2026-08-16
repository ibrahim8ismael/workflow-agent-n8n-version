import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LangGraphModule } from '../../infrastructure/langgraph/langgraph.module';
import { LLMRuntimeModule } from '../../infrastructure/llm-runtime/llm-runtime.module';
import { N8nModule } from '../../infrastructure/n8n/n8n.module';
import { ToolManifestService } from '../../infrastructure/tools/tool-manifest.service';
import { AgentsModule } from '../agents/agents.module';
import { BillingModule } from '../billing/billing.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { PlannerModule } from '../planner/planner.module';
import { RunsModule } from '../runs/runs.module';
import { SkillsModule } from '../skills/skills.module';
import { ConversationRuntimeService } from './conversation/conversation-runtime.service';
import { EmployeeDesignRuntimeService } from './employee-design/employee-design-runtime.service';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { RuntimeRepository } from './repositories/runtime.repository';
import { RuntimeController } from './runtime.controller';
import { ContextBuilderService } from './services/context-builder.service';
import { EmployeeDesignSessionService } from './services/employee-design-session.service';
import { JaafarApprovalService } from './services/jaafar-approval.service';
import { JaafarContextLoaderService } from './services/jaafar-context-loader.service';
import { JaafarConversationGraphService } from './services/jaafar-conversation-graph.service';
import { JaafarEmployeeDesignGraphService } from './services/jaafar-employee-design-graph.service';
import { JaafarEventNormalizerService } from './services/jaafar-event-normalizer.service';
import { JaafarExecutionGraphService } from './services/jaafar-execution-graph.service';
import { JaafarFinalResponseService } from './services/jaafar-final-response.service';
import { JaafarGraphService } from './services/jaafar-graph.service';
import { JaafarHarnessService } from './services/jaafar-harness.service';
import { JaafarIdempotencyService } from './services/jaafar-idempotency.service';
import { JaafarMemoryPolicyService } from './services/jaafar-memory-policy.service';
import { JaafarPlanningService } from './services/jaafar-planning.service';
import { JaafarRequestUnderstandingService } from './services/jaafar-request-understanding.service';
import { JaafarRuntimeService } from './services/jaafar-runtime.service';
import { JaafarUnderstandingGraphService } from './services/jaafar-understanding-graph.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeBillingAccountingService } from './services/runtime-billing-accounting.service';
import { RuntimeEventJournalService } from './services/runtime-event-journal.service';
import { RuntimeObservabilityService } from './services/runtime-observability.service';
import { ToolAuditService } from './services/tool-audit.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { ToolPermissionService } from './services/tool-permission.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { RuntimeCacheService } from './shared/runtime-cache.service';
import { SkillEmployeeRuntimeService } from './skill/skill-employee-runtime.service';

@Module({
  imports: [
    DatabaseModule,
    BillingModule,
    LLMRuntimeModule,
    N8nModule,
    LangGraphModule,
    AgentsModule,
    RunsModule,
    ConversationsModule,
    ChannelsModule,
    IntegrationsModule,
    KnowledgeModule,
    MemoryModule,
    PlannerModule,
    SkillsModule,
  ],
  controllers: [RuntimeController],
  providers: [
    RuntimeEventJournalService,
    RuntimeObservabilityService,
    RuntimeBillingAccountingService,
    RuntimeCacheService,
    ConversationRuntimeService,
    EmployeeDesignRuntimeService,
    SkillEmployeeRuntimeService,
    RuntimeService,
    ToolManifestService,
    ContextBuilderService,
    JaafarEventNormalizerService,
    JaafarHarnessService,
    JaafarApprovalService,
    JaafarIdempotencyService,
    JaafarMemoryPolicyService,
    ToolRegistryService,
    ToolExecutorService,
    JaafarContextLoaderService,
    JaafarRequestUnderstandingService,
    JaafarRuntimeService,
    JaafarPlanningService,
    JaafarUnderstandingGraphService,
    JaafarExecutionGraphService,
    JaafarConversationGraphService,
    JaafarEmployeeDesignGraphService,
    JaafarFinalResponseService,
    JaafarGraphService,
    EmployeeDesignSessionService,
    ToolAuditService,
    ToolPermissionService,
    RuntimeRepository,
    IdempotencyRepository,
  ],
  exports: [JaafarRuntimeService],
})
export class RuntimeModule {}
