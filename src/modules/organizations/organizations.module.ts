import { Module } from '@nestjs/common';
import { OrganizationsController } from './controllers/organizations.controller';
import { OrganizationsService } from './services/organizations.service';
import { OrganizationsRepository } from './repositories/organizations.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationsRepository],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
