import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { BillingModule } from '../billing/billing.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminCouponsController } from './controllers/admin-coupons.controller';
import { AdminFeatureFlagsController } from './controllers/admin-feature-flags.controller';
import { AdminOrganizationsController } from './controllers/admin-organizations.controller';
import { AdminPlansController } from './controllers/admin-plans.controller';
import { AdminSubscriptionsController } from './controllers/admin-subscriptions.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { SystemAdminGuard } from './guards/system-admin.guard';
import { AdminAuditRepository } from './repositories/admin-audit.repository';
import { AdminOrganizationsRepository } from './repositories/admin-organizations.repository';
import { AdminSubscriptionsRepository } from './repositories/admin-subscriptions.repository';
import { AdminUsersRepository } from './repositories/admin-users.repository';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminBillingService } from './services/admin-billing.service';
import { AdminFeatureFlagsService } from './services/admin-feature-flags.service';
import { AdminImpersonationService } from './services/admin-impersonation.service';
import { AdminOrganizationsService } from './services/admin-organizations.service';
import { AdminSubscriptionsService } from './services/admin-subscriptions.service';
import { AdminUsersService } from './services/admin-users.service';

@Module({
  imports: [DatabaseModule, BillingModule],
  controllers: [
    AdminUsersController,
    AdminOrganizationsController,
    AdminSubscriptionsController,
    AdminBillingController,
    AdminPlansController,
    AdminCouponsController,
    AdminAnalyticsController,
    AdminFeatureFlagsController,
    AdminAuditController,
  ],
  providers: [
    AdminUsersService,
    AdminOrganizationsService,
    AdminSubscriptionsService,
    AdminBillingService,
    AdminAnalyticsService,
    AdminImpersonationService,
    AdminFeatureFlagsService,
    AdminUsersRepository,
    AdminOrganizationsRepository,
    AdminSubscriptionsRepository,
    AdminAuditRepository,
    SystemAdminGuard,
  ],
  exports: [AdminFeatureFlagsService],
})
export class AdminModule {}
