import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IntegrationsController } from './controllers/integrations.controller';
import { IntegrationsRepository } from './repositories/integrations.repository';
import { IntegrationsService } from './services/integrations.service';

@Module({
  imports: [DatabaseModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationsRepository],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
