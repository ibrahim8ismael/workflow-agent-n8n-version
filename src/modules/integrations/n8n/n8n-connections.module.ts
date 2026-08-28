import { Module } from '@nestjs/common';
import { SecretBoxService } from '../../../infrastructure/crypto/secret-box.service';
import { N8nClientApiService } from '../../../infrastructure/n8n/n8n-client-api.service';
import { N8nConnectionsController } from './controllers/n8n-connections.controller';
import { N8nConnectionsRepository } from './repositories/n8n-connections.repository';
import { N8nConnectionsService } from './services/n8n-connections.service';

@Module({
  controllers: [N8nConnectionsController],
  providers: [
    N8nConnectionsRepository,
    N8nConnectionsService,
    SecretBoxService,
    N8nClientApiService,
  ],
  exports: [N8nConnectionsService],
})
export class N8nConnectionsModule {}
