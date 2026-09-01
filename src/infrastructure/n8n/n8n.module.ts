import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IntegrationsModule } from '../../modules/integrations/integrations.module';
import { SecretBoxService } from '../crypto/secret-box.service';
import { N8nClientApiService } from './n8n-client-api.service';
import { N8nProvisionerService } from './n8n-provisioner.service';
import { N8nWorkflowExecutorService } from './n8n-workflow-executor.service';

@Module({
  imports: [DatabaseModule, IntegrationsModule],
  providers: [
    N8nClientApiService,
    SecretBoxService,
    N8nWorkflowExecutorService,
    N8nProvisionerService,
  ],
  exports: [N8nWorkflowExecutorService, N8nProvisionerService],
})
export class N8nModule {}
