import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { BillingController } from './controllers/billing.controller';
import { SubscriptionController } from './controllers/subscription.controller';
import { WalletController } from './controllers/wallet.controller';
import { TopUpController } from './controllers/top-up.controller';
import { CouponController } from './controllers/coupon.controller';
import { UsageController } from './controllers/usage.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { BillingService } from './services/billing.service';
import { SubscriptionService } from './services/subscription.service';
import { WalletService } from './services/wallet.service';
import { QuotaEnforcerService } from './services/quota-enforcer.service';
import { UsageMeterService } from './services/usage-meter.service';
import { TopUpService } from './services/top-up.service';
import { CouponService } from './services/coupon.service';
import { InvoiceService } from './services/invoice.service';
import { CostEngineService } from './services/cost-engine.service';
import { BillingEventService } from './services/billing-event.service';
import { PaymentProviderService } from './services/payment-provider.service';
import { BillingRepository } from './repositories/billing.repository';
import { WalletRepository } from './repositories/wallet.repository';
import { WalletTransactionRepository } from './repositories/wallet-transaction.repository';
import { SubscriptionRepository } from './repositories/subscription.repository';
import { UsageMeterRepository } from './repositories/usage-meter.repository';
import { TopUpRepository } from './repositories/top-up.repository';
import { CouponRepository } from './repositories/coupon.repository';
import { InvoiceRepository } from './repositories/invoice.repository';
import { BillingEventRepository } from './repositories/billing-event.repository';
import { SubscriptionRenewalWorker } from './workers/subscription-renewal.worker';
import { UsageResetWorker } from './workers/usage-reset.worker';
import { ExpiryCheckWorker } from './workers/expiry-check.worker';

@Module({
  imports: [DatabaseModule],
  controllers: [
    BillingController,
    SubscriptionController,
    WalletController,
    TopUpController,
    CouponController,
    UsageController,
    InvoiceController,
  ],
  providers: [
    BillingService,
    SubscriptionService,
    WalletService,
    QuotaEnforcerService,
    UsageMeterService,
    TopUpService,
    CouponService,
    InvoiceService,
    CostEngineService,
    BillingEventService,
    PaymentProviderService,
    BillingRepository,
    WalletRepository,
    WalletTransactionRepository,
    SubscriptionRepository,
    UsageMeterRepository,
    TopUpRepository,
    CouponRepository,
    InvoiceRepository,
    BillingEventRepository,
    SubscriptionRenewalWorker,
    UsageResetWorker,
    ExpiryCheckWorker,
  ],
  exports: [
    BillingService,
    SubscriptionService,
    WalletService,
    QuotaEnforcerService,
    UsageMeterService,
    TopUpService,
    CouponService,
    CostEngineService,
    BillingEventService,
  ],
})
export class BillingModule {}
