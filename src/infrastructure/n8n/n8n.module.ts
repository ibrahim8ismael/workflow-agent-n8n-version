import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IntegrationsModule } from '../../modules/integrations/integrations.module';
import { N8nIntegrationRegistryService } from './n8n-integration-registry.service';
import { N8nProvisionerService } from './n8n-provisioner.service';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';
import { N8nWorkflowSyncService } from './n8n-workflow-sync.service';

@Module({
  imports: [DatabaseModule, IntegrationsModule],
  providers: [
    N8nIntegrationRegistryService,
    N8nWorkflowExecutorService,
    N8nWorkflowSyncService,
    N8nProvisionerService,
  ],
  exports: [
    N8nIntegrationRegistryService,
    N8nWorkflowExecutorService,
    N8nWorkflowSyncService,
    N8nProvisionerService,
  ],
})
export class N8nModule {}
