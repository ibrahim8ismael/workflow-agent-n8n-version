import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IntegrationsController } from './controllers/integrations.controller';
import { N8nConnectionsController } from './n8n/controllers/n8n-connections.controller';
import { N8nConnectionsModule } from './n8n/n8n-connections.module';
import { IntegrationsRepository } from './repositories/integrations.repository';
import { IntegrationsService } from './services/integrations.service';

@Module({
  // N8nConnectionsController is declared BEFORE IntegrationsController so its
  // literal routes (/integrations/n8n) register ahead of the legacy
  // @Get(':id')/@Delete(':id') wildcards (route-shadowing fix).
  imports: [DatabaseModule, N8nConnectionsModule],
  controllers: [N8nConnectionsController, IntegrationsController],
  providers: [IntegrationsService, IntegrationsRepository],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
