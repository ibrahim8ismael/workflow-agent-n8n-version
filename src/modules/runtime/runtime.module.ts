import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LangGraphModule } from '../../infrastructure/langgraph/langgraph.module';
import { LLMRuntimeModule } from '../../infrastructure/llm-runtime/llm-runtime.module';
import { N8nModule } from '../../infrastructure/n8n/n8n.module';
import { ToolManifestService } from '../../infrastructure/tools/tool-manifest.service';
import { AgentsModule } from '../agents/agents.module';
import { AutomationsModule } from '../automations/automations.module';
import { BillingModule } from '../billing/billing.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { N8nConnectionsModule } from '../integrations/n8n/n8n-connections.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { PlannerModule } from '../planner/planner.module';
import { RunsModule } from '../runs/runs.module';
import { ConversationRuntimeService } from './conversation/conversation-runtime.service';
import { JaafarEvalService } from './eval/jaafar-eval.service';
import { JaafarFailureEvalService } from './eval/jaafar-failure-eval.service';
import { IdempotencyRepository } from './repositories/idempotency.repository';
import { RuntimeRepository } from './repositories/runtime.repository';
import { RuntimeController } from './runtime.controller';
import { AgentRunTraceService } from './services/agent-run-trace.service';
import { AutomationErrorClassifierService } from './services/automation-error-classifier.service';
import { AutomationPlanReviewService } from './services/automation-plan-review.service';
import { AutomationRepairService } from './services/automation-repair.service';
import { AutomationRuntimeValidatorService } from './services/automation-runtime-validator.service';
import { AutomationToolResolverService } from './services/automation-tool-resolver.service';
import { AutomationWorkflowBuilderService } from './services/automation-workflow-builder.service';
import { ContextBuilderService } from './services/context-builder.service';
import { IntegrationRegistryService } from './services/integration-registry.service';
import { JaafarApprovalService } from './services/jaafar-approval.service';
import { JaafarAutomationGraphService } from './services/jaafar-automation-graph.service';
import { JaafarContextLoaderService } from './services/jaafar-context-loader.service';
import { JaafarContextManagerService } from './services/jaafar-context-manager.service';
import { JaafarConversationGraphService } from './services/jaafar-conversation-graph.service';
import { JaafarEventNormalizerService } from './services/jaafar-event-normalizer.service';
import { JaafarExecutionGraphService } from './services/jaafar-execution-graph.service';
import { JaafarFinalResponseService } from './services/jaafar-final-response.service';
import { JaafarGraphService } from './services/jaafar-graph.service';
import { JaafarHarnessService } from './services/jaafar-harness.service';
import { JaafarIdempotencyService } from './services/jaafar-idempotency.service';
import { JaafarMemoryPolicyService } from './services/jaafar-memory-policy.service';
import { JaafarPlanningService } from './services/jaafar-planning.service';
import { JaafarQualityMetricsService } from './services/jaafar-quality-metrics.service';
import { JaafarRequestUnderstandingService } from './services/jaafar-request-understanding.service';
import { JaafarRuntimeService } from './services/jaafar-runtime.service';
import { JaafarUnderstandingGraphService } from './services/jaafar-understanding-graph.service';
import { NodeResolverService } from './services/node-resolver.service';
import { RuntimeService } from './services/runtime.service';
import { RuntimeBillingAccountingService } from './services/runtime-billing-accounting.service';
import { RuntimeEventJournalService } from './services/runtime-event-journal.service';
import { RuntimeObservabilityService } from './services/runtime-observability.service';
import { ToolAuditService } from './services/tool-audit.service';
import { ToolExecutorService } from './services/tool-executor.service';
import { ToolPermissionService } from './services/tool-permission.service';
import { ToolRegistryService } from './services/tool-registry.service';
import { RuntimeCacheService } from './shared/runtime-cache.service';

@Module({
  imports: [
    DatabaseModule,
    BillingModule,
    LLMRuntimeModule,
    N8nModule,
    LangGraphModule,
    AgentsModule,
    AutomationsModule,
    RunsModule,
    ConversationsModule,
    ChannelsModule,
    IntegrationsModule,
    N8nConnectionsModule,
    KnowledgeModule,
    MemoryModule,
    PlannerModule,
  ],
  controllers: [RuntimeController],
  providers: [
    RuntimeEventJournalService,
    RuntimeObservabilityService,
    RuntimeBillingAccountingService,
    RuntimeCacheService,
    ConversationRuntimeService,
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
    JaafarAutomationGraphService,
    JaafarFinalResponseService,
    JaafarGraphService,
    AutomationPlanReviewService,
    AgentRunTraceService,
    JaafarEvalService,
    JaafarFailureEvalService,
    JaafarQualityMetricsService,
    AutomationErrorClassifierService,
    AutomationRuntimeValidatorService,
    AutomationRepairService,
    AutomationWorkflowBuilderService,
    IntegrationRegistryService,
    NodeResolverService,
    JaafarContextManagerService,
    AutomationToolResolverService,
    ToolAuditService,
    ToolPermissionService,
    RuntimeRepository,
    IdempotencyRepository,
  ],
  exports: [JaafarRuntimeService],
})
export class RuntimeModule {}
