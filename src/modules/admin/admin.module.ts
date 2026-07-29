import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { BillingModule } from '../billing/billing.module';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminOrganizationsController } from './controllers/admin-organizations.controller';
import { AdminSubscriptionsController } from './controllers/admin-subscriptions.controller';
import { AdminBillingController } from './controllers/admin-billing.controller';
import { AdminPlansController } from './controllers/admin-plans.controller';
import { AdminCouponsController } from './controllers/admin-coupons.controller';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminFeatureFlagsController } from './controllers/admin-feature-flags.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AdminUsersService } from './services/admin-users.service';
import { AdminOrganizationsService } from './services/admin-organizations.service';
import { AdminSubscriptionsService } from './services/admin-subscriptions.service';
import { AdminBillingService } from './services/admin-billing.service';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminImpersonationService } from './services/admin-impersonation.service';
import { AdminFeatureFlagsService } from './services/admin-feature-flags.service';
import { AdminUsersRepository } from './repositories/admin-users.repository';
import { AdminOrganizationsRepository } from './repositories/admin-organizations.repository';
import { AdminSubscriptionsRepository } from './repositories/admin-subscriptions.repository';
import { AdminAuditRepository } from './repositories/admin-audit.repository';
import { SystemAdminGuard } from './guards/system-admin.guard';

@Module({
  imports: [DatabaseModule, JwtModule, BillingModule],
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
