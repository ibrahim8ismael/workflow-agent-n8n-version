import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../modules/integrations/integrations.module';
import { N8nIntegrationRegistryService } from './n8n-integration-registry.service';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

@Module({
  imports: [IntegrationsModule],
  providers: [N8nIntegrationRegistryService, N8nWorkflowExecutorService],
  exports: [N8nIntegrationRegistryService, N8nWorkflowExecutorService],
})
export class N8nModule {}
