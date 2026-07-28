import { Module } from '@nestjs/common';
import { IntegrationsController } from './controllers/integrations.controller';
import { IntegrationsService } from './services/integrations.service';
import { IntegrationsRepository } from './repositories/integrations.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationsRepository],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
