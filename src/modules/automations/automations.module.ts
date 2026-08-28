import { Module } from '@nestjs/common';
import { N8nConnectionsModule } from '../integrations/n8n/n8n-connections.module';
import { AutomationsController } from './controllers/automations.controller';
import { AutomationsRepository } from './repositories/automations.repository';
import { AutomationsService } from './services/automations.service';

@Module({
  imports: [N8nConnectionsModule],
  controllers: [AutomationsController],
  providers: [AutomationsRepository, AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
