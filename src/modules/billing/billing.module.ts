import { Module } from '@nestjs/common';
import { BillingController } from './controllers/billing.controller';
import { BillingService } from './services/billing.service';
import { BillingRepository } from './repositories/billing.repository';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [BillingController],
  providers: [BillingService, BillingRepository],
  exports: [BillingService],
})
export class BillingModule {}
