# Woops — Admin Module & Billing System Plan

> Status: Draft  
> Phase: Planning  
> Scope: Admin Module + Subscription Model + Credit System  

---

## Context

This plan covers two interconnected systems:

1. **Admin Module** — System Administrator dashboard and operations (internal Woops team)
2. **Billing System** — Subscription plans, AI Credits wallet, Operations wallet, top-ups, usage enforcement

The billing system follows the philosophy in `@RULE.BILLING.md`:  
**Customers only see AI Credits + Operations** — never tokens, CPU, RAM, or execution counts.

---

## Part 1 — Admin Module

### What the Admin Module IS

The Admin Module is the **internal control panel for the Woops team (System Administrators)**.  
It is NOT a customer-facing feature. It is NOT the same as Organization Admin.

### Admin Module Scope

| Capability | Description |
|---|---|
| User Management | View all users, suspend/reactivate, impersonate (audited) |
| Organization Management | View all orgs, suspend/reactivate, force-cancel subscriptions |
| Subscription Management | View/modify any subscription, apply discounts, issue refunds |
| Credit Management | Manually top-up AI Credits/Operations, view burn rates |
| Feature Flags | Toggle features per org/user/plan |
| Analytics | MRR, ARR, ARPU, LTV, churn, credit burn, upgrade/downgrade rates |
| System Logs | Audit logs, impersonation history, billing events |
| AI Provider Management | Configure available AI models, provider routing |
| Plan Management | Create/edit plans, change limits, pricing |
| Coupon & Promotion Management | Create discount codes, promotional credits |

### Admin Module — NestJS Structure

```
src/modules/admin/
├── admin.module.ts
├── controllers/
│   ├── admin-users.controller.ts           # GET /admin/users, PATCH, suspend, impersonate
│   ├── admin-organizations.controller.ts   # GET /admin/organizations, suspend
│   ├── admin-subscriptions.controller.ts   # GET /admin/subscriptions, modify, refund
│   ├── admin-billing.controller.ts         # Credits top-up, wallet ops, billing events
│   ├── admin-plans.controller.ts           # CRUD for subscription plans
│   ├── admin-coupons.controller.ts         # CRUD for coupons and promotions
│   ├── admin-analytics.controller.ts       # MRR, ARR, churn, etc.
│   ├── admin-feature-flags.controller.ts   # Feature flag management
│   └── admin-audit.controller.ts           # Audit logs, impersonation history
├── services/
│   ├── admin-users.service.ts
│   ├── admin-organizations.service.ts
│   ├── admin-subscriptions.service.ts
│   ├── admin-billing.service.ts
│   ├── admin-analytics.service.ts
│   ├── admin-impersonation.service.ts      # Audited impersonation flow
│   └── admin-feature-flags.service.ts
├── repositories/
│   ├── admin-users.repository.ts
│   ├── admin-organizations.repository.ts
│   ├── admin-subscriptions.repository.ts
│   └── admin-audit.repository.ts
├── guards/
│   └── system-admin.guard.ts               # Blocks non-SYSTEM_ADMINISTRATOR requests
├── dto/
│   ├── admin-impersonation.dto.ts
│   ├── admin-credit-adjustment.dto.ts
│   ├── admin-plan-update.dto.ts
│   └── admin-suspension.dto.ts
└── events/
    ├── user-suspended.event.ts
    ├── org-suspended.event.ts
    └── admin-impersonation-started.event.ts
```

### Admin Routes

All admin routes are under `/api/v1/admin/` and protected by `SystemAdminGuard`.

```
GET    /api/v1/admin/users
GET    /api/v1/admin/users/:id
PATCH  /api/v1/admin/users/:id/suspend
PATCH  /api/v1/admin/users/:id/reactivate
POST   /api/v1/admin/users/:id/impersonate

GET    /api/v1/admin/organizations
GET    /api/v1/admin/organizations/:id
PATCH  /api/v1/admin/organizations/:id/suspend

GET    /api/v1/admin/subscriptions
GET    /api/v1/admin/subscriptions/:id
PATCH  /api/v1/admin/subscriptions/:id
POST   /api/v1/admin/subscriptions/:id/cancel
POST   /api/v1/admin/subscriptions/:id/refund

GET    /api/v1/admin/plans
POST   /api/v1/admin/plans
PATCH  /api/v1/admin/plans/:id

POST   /api/v1/admin/wallets/:id/top-up
POST   /api/v1/admin/wallets/:id/deduct

GET    /api/v1/admin/analytics/mrr
GET    /api/v1/admin/analytics/churn
GET    /api/v1/admin/analytics/credits-burn-rate

GET    /api/v1/admin/audit-logs
GET    /api/v1/admin/feature-flags
PATCH  /api/v1/admin/feature-flags/:key

POST   /api/v1/admin/coupons
GET    /api/v1/admin/coupons
PATCH  /api/v1/admin/coupons/:id
```

### Impersonation System

System Administrators can impersonate users for support purposes.  
Every impersonation is **fully audited**.

Audit record captures:
- `adminUserId`
- `targetUserId` or `targetOrganizationId`
- `reason` (required text)
- `ip`
- `userAgent`
- `startedAt`
- `endedAt`

An impersonation JWT carries a special claim `{ impersonatedBy: adminUserId }`.  
The audit log is write-only for admins — no admin can delete or modify impersonation records.

---

## Part 2 — Billing System

### Philosophy (from @RULE.BILLING.md)

Customers **never** see:
- Tokens
- CPU
- RAM
- Execution counts

Customers **only** see:
- **AI Credits** — consumed by every AI operation
- **Operations** — consumed by every workflow/automation action

Internally, Woops maps real costs (CPU, memory, runtime, AI calls, network) into these two units.

---

### Billing Dimensions

#### AI Credits

Consumed by:
- AI Builder (building agents via AI)
- Agent Runtime (each AI inference call)
- AI Skills execution
- AI Planning / ReAct loops
- AI Memory read/write
- Vision, Voice, Embeddings
- RAG retrieval
- Summaries, Classification, Translation

#### Operations

Consumed by:
- Workflow Execution (each node execution)
- API Calls (HTTP nodes)
- Code Nodes
- Database Nodes
- Loop iterations
- Browser automation
- Email send
- Webhook triggers
- Cron executions
- Queue jobs
- Background workers

---

### Subscription Plans

| Plan | Target | AI Credits/mo | Operations/mo | Price |
|---|---|---|---|---|
| **Free** | Try the platform | 1,000 | 5,000 | $0 |
| **Pro** | Solo founders, small teams | 20,000 | 100,000 | ~$49/mo |
| **Scale** | Growing businesses | 100,000 | 500,000 | ~$149/mo |
| **Enterprise** | Large orgs | Custom | Custom | Custom |

> Exact numbers TBD by Product Team. These are placeholders.

#### Plan Features Matrix

| Feature      |  Free  |  Pro | Scale | Enterprise |
| ------------ | :----: | :--: | :---: | :--------: |
| AI Credits   |    ✅   |   ✅  |   ✅   |   Custom   |
| Operations   |    ✅   |   ✅  |   ✅   |   Custom   |
| AI Employees |    1   |   5  |   20  |  Unlimited |
| Team Members |    1   |   3  |   10  |  Unlimited |
| Storage      | 100 MB | 1 GB | 10 GB |   Custom   |
| Projects     |    1   |  10  | Unlimited | Unlimited |
| Knowledge Bases |  1   |   5  | Unlimited | Unlimited |
| Channels     |    1   |  All |  All  |    All     |
| Integrations |    3   |  All |  All  |    All     |
| Memory       | Limited| Full |  Full | Dedicated  |
| Vector Storage| 10K chunks | 500K chunks | 5M chunks | Custom |
| API Access   |    ❌   |   ✅  |   ✅   |     ✅     |
| Webhooks     |    ❌   |   ✅  |   ✅   |     ✅     |
| Custom Domains|   ❌   |   ❌  |   ✅   |     ✅     |
| Analytics    |  Basic | Advanced | Full | Custom  |

---

### Wallet System

Each subscriber (User or Organization) has **two wallets**:

```
Wallet
├── aiCreditsBalance      — included monthly credits
├── operationsBalance     — included monthly operations
├── aiCreditsTopUp        — purchased top-up credits (never expire while active)
├── operationsTopUp       — purchased top-up operations
├── bonusCredits          — promotional/gifted credits (may expire)
└── bonusOperations       — promotional/gifted operations (may expire)
```

**Deduction order:**
1. Included monthly credits (reset on billing period)
2. Bonus/promotional credits (FIFO, respecting expiry)
3. Top-up credits (never expire)

---

### Usage Limits

| Limit Type | Behavior |
|---|---|
| **Soft Limit** | Alert user at 80% usage. Operations continue. |
| **Hard Limit** | Stop execution. Return `QUOTA_EXCEEDED` error. |
| **Grace Limit** | Allow 10% overage buffer after hard limit before true block. |

**Overages:**
- Free plan: no overages. Hard stop.
- Pro / Scale: optional auto-recharge or top-up prompts.
- Enterprise: custom overage agreements.

**Monthly Reset:**
- Included credits reset on the billing period date.
- Top-up and bonus credits carry over.

---

### Internal Cost Engine

The Cost Engine is **internal only** — customers never see this.

It takes raw infrastructure metrics and maps them to Operations:

```
Inputs                          Output
──────                          ──────
CPU usage          ──┐
Memory usage         │
Runtime duration     │──→  Cost Engine  ──→  Operations consumed
Active Runtime       │
Browser Runtime    ──┘
Queue Jobs         ──┐
AI Calls             │──→  Cost Engine  ──→  AI Credits consumed
Network              │
Storage ops          │
Database ops       ──┘
```

The Cost Engine is a service (`CostEngineService`) in the billing module.  
It is called by every service that consumes credits or operations.

---

### Domain Model

#### New/Modified Prisma Models

```prisma
// ── Billing Enums ─────────────────────────────

enum WalletTransactionType {
  SUBSCRIPTION_CREDIT      // Monthly included credits on renewal
  TOP_UP_PURCHASE          // User purchased top-up
  BONUS_GRANT              // Admin/promo granted credits
  CONSUMPTION              // Used by AI or operations
  REFUND                   // Credit restored due to refund
  EXPIRATION               // Bonus credits expired
  ADJUSTMENT               // Admin manual adjustment
}

enum BillingEventType {
  SUBSCRIPTION_CREATED
  SUBSCRIPTION_RENEWED
  SUBSCRIPTION_UPGRADED
  SUBSCRIPTION_DOWNGRADED
  SUBSCRIPTION_CANCELED
  SUBSCRIPTION_EXPIRED
  TOP_UP_PURCHASED
  CREDIT_CONSUMED
  OPERATION_CONSUMED
  REFUND_ISSUED
  CHARGE_FAILED
  GRACE_PERIOD_STARTED
  HARD_LIMIT_REACHED
}

enum CouponType {
  PERCENTAGE
  FIXED_AMOUNT
  FREE_CREDITS
  FREE_OPERATIONS
}

// ── Wallet ────────────────────────────────────

model Wallet {
  id                    String   @id @default(uuid())
  userId                String?  @unique
  organizationId        String?  @unique

  aiCreditsBalance      BigInt   @default(0)   // included monthly credits
  aiCreditsTopUp        BigInt   @default(0)   // purchased top-ups
  aiCreditsBonus        BigInt   @default(0)   // bonus/promo credits

  operationsBalance     BigInt   @default(0)
  operationsTopUp       BigInt   @default(0)
  operationsBonus       BigInt   @default(0)

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  user                  User?         @relation(...)
  organization          Organization? @relation(...)
  transactions          WalletTransaction[]

  @@map("wallets")
}

// ── Wallet Transaction (immutable ledger) ─────

model WalletTransaction {
  id              String                  @id @default(uuid())
  walletId        String
  type            WalletTransactionType
  creditsDelta    BigInt                  // positive = credit, negative = debit
  operationsDelta BigInt
  balanceBefore   BigInt
  balanceAfter    BigInt
  description     String?
  metadata        Json?
  idempotencyKey  String?                 @unique
  createdAt       DateTime                @default(now())

  wallet          Wallet  @relation(...)

  @@index([walletId])
  @@index([type])
  @@index([createdAt])
  @@map("wallet_transactions")
}

// ── Usage Meter ───────────────────────────────

model UsageMeter {
  id                String   @id @default(uuid())
  walletId          String
  periodStart       DateTime
  periodEnd         DateTime

  aiCreditsUsed     BigInt   @default(0)
  operationsUsed    BigInt   @default(0)

  aiCreditsLimit    BigInt   // from plan quota
  operationsLimit   BigInt

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  wallet            Wallet   @relation(...)

  @@unique([walletId, periodStart])
  @@map("usage_meters")
}

// ── Top-Up Package ────────────────────────────

model TopUpPackage {
  id              String   @id @default(uuid())
  name            String
  aiCredits       BigInt
  operations      BigInt
  price           Decimal
  currency        String   @default("USD")
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  purchases       TopUpPurchase[]

  @@map("top_up_packages")
}

model TopUpPurchase {
  id                String   @id @default(uuid())
  packageId         String
  walletId          String
  amount            Decimal
  currency          String
  status            String   @default("PENDING")
  providerPaymentId String?
  idempotencyKey    String   @unique
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  package           TopUpPackage @relation(...)

  @@index([walletId])
  @@map("top_up_purchases")
}

// ── Coupon & Discount ─────────────────────────

model Coupon {
  id                String     @id @default(uuid())
  code              String     @unique
  type              CouponType
  value             Decimal?   // percentage or fixed amount
  aiCreditsGrant    BigInt?    // free credits
  operationsGrant   BigInt?    // free operations
  maxUses           Int?
  usedCount         Int        @default(0)
  expiresAt         DateTime?
  isActive          Boolean    @default(true)
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  redemptions       CouponRedemption[]

  @@map("coupons")
}

model CouponRedemption {
  id             String   @id @default(uuid())
  couponId       String
  userId         String?
  organizationId String?
  redeemedAt     DateTime @default(now())

  coupon         Coupon   @relation(...)

  @@index([couponId])
  @@map("coupon_redemptions")
}

// ── Billing Event Log (append-only) ───────────

model BillingEvent {
  id             String           @id @default(uuid())
  type           BillingEventType
  userId         String?
  organizationId String?
  subscriptionId String?
  walletId       String?
  metadata       Json?
  createdAt      DateTime         @default(now())

  @@index([type])
  @@index([userId])
  @@index([organizationId])
  @@index([subscriptionId])
  @@index([createdAt])
  @@map("billing_events")
}

// ── Feature Flag ──────────────────────────────

model FeatureFlag {
  id             String   @id @default(uuid())
  key            String   @unique
  description    String?
  defaultValue   Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  overrides      FeatureFlagOverride[]

  @@map("feature_flags")
}

model FeatureFlagOverride {
  id             String   @id @default(uuid())
  flagId         String
  userId         String?
  organizationId String?
  planTier       SubscriptionTier?
  value          Boolean
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  flag           FeatureFlag @relation(...)

  @@map("feature_flag_overrides")
}

// ── Quota (per plan) ──────────────────────────

model PlanQuota {
  id               String           @id @default(uuid())
  planId           String           @unique
  aiCreditsPerMonth    BigInt
  operationsPerMonth   BigInt
  maxAgents            Int
  maxTeamMembers       Int
  maxKnowledgeBases    Int
  storageBytes         BigInt
  maxChannels          Int
  maxIntegrations      Int?
  maxApiKeys           Int?
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt

  plan             SubscriptionPlan @relation(...)

  @@map("plan_quotas")
}

// ── Impersonation Log ─────────────────────────

model ImpersonationLog {
  id             String   @id @default(uuid())
  adminUserId    String
  targetUserId   String?
  targetOrgId    String?
  reason         String
  ip             String?
  userAgent      String?
  startedAt      DateTime @default(now())
  endedAt        DateTime?

  @@index([adminUserId])
  @@index([targetUserId])
  @@map("impersonation_logs")
}
```

---

### Billing Module — NestJS Structure

```
src/modules/billing/
├── billing.module.ts
├── controllers/
│   ├── subscription.controller.ts      # Customer: GET/POST/PATCH subscriptions
│   ├── wallet.controller.ts            # Customer: GET wallet balance
│   ├── top-up.controller.ts            # Customer: purchase top-up packages
│   ├── coupon.controller.ts            # Customer: redeem coupon
│   ├── invoice.controller.ts           # Customer: list invoices
│   └── usage.controller.ts             # Customer: GET current usage
├── services/
│   ├── subscription.service.ts         # Subscription lifecycle
│   ├── wallet.service.ts               # Wallet balance operations (atomic)
│   ├── cost-engine.service.ts          # Maps infra metrics → Credits/Operations
│   ├── usage-meter.service.ts          # Track usage per period
│   ├── quota-enforcer.service.ts       # Check limits, soft/hard/grace
│   ├── top-up.service.ts               # Top-up purchase flow
│   ├── coupon.service.ts               # Coupon validation & redemption
│   ├── invoice.service.ts              # Invoice management
│   ├── billing-event.service.ts        # Append-only billing event log
│   └── payment-provider.service.ts     # Adapter to Stripe/payment provider
├── repositories/
│   ├── subscription.repository.ts
│   ├── wallet.repository.ts
│   ├── wallet-transaction.repository.ts
│   ├── usage-meter.repository.ts
│   ├── top-up.repository.ts
│   ├── coupon.repository.ts
│   ├── invoice.repository.ts
│   └── billing-event.repository.ts
├── interfaces/
│   ├── payment-provider.interface.ts   # Abstraction over Stripe/Paddle/etc.
│   ├── cost-engine.interface.ts
│   └── quota-policy.interface.ts
├── dto/
│   ├── create-subscription.dto.ts
│   ├── upgrade-subscription.dto.ts
│   ├── purchase-top-up.dto.ts
│   ├── redeem-coupon.dto.ts
│   └── usage-query.dto.ts
├── events/
│   ├── subscription-created.event.ts
│   ├── subscription-upgraded.event.ts
│   ├── subscription-downgraded.event.ts
│   ├── subscription-canceled.event.ts
│   ├── credits-consumed.event.ts
│   ├── operations-consumed.event.ts
│   ├── soft-limit-reached.event.ts
│   ├── hard-limit-reached.event.ts
│   └── top-up-purchased.event.ts
├── constants/
│   ├── billing.constants.ts            # SOFT_LIMIT_THRESHOLD = 0.8, etc.
│   └── quota.constants.ts
├── workers/
│   ├── subscription-renewal.worker.ts  # Monthly renewal processing
│   ├── usage-reset.worker.ts           # Reset included credits on period end
│   └── expiry-check.worker.ts          # Expire bonus credits
└── mappers/
    └── subscription.mapper.ts
```

---

### Credit Consumption Flow

Every service that uses AI or Operations calls the `QuotaEnforcer` before executing:

```
AgentRuntime calls AI
         │
         ▼
QuotaEnforcer.checkAiCredits(orgId, estimatedCost)
         │
    ┌────┴─────┐
    │          │
 ALLOWED    REJECTED (QUOTA_EXCEEDED)
    │
    ▼
Execute AI call
    │
    ▼
CostEngine.calculateAiCost(model, tokens, latency)
    │
    ▼
WalletService.deductAiCredits(orgId, amount, idempotencyKey)
    │
    ▼
BillingEvent logged
    │
    ▼
UsageMeter updated
```

---

### Idempotency

Every wallet deduction must carry an `idempotencyKey` to prevent duplicate charges:

```
idempotencyKey = `${executionId}:${nodeId}:ai_credits`
```

Transactions with duplicate idempotency keys are silently ignored (not double-counted).

---

### Security Rules

| Rule | Implementation |
|---|---|
| Wallet mutations are atomic | PostgreSQL transactions |
| No double-charge | Idempotency key on `WalletTransaction` |
| No negative balance without grace | QuotaEnforcer blocks before deduct |
| Billing events are append-only | No UPDATE/DELETE on `billing_events` |
| Impersonation is audited | `ImpersonationLog` — write-only |
| Admin routes require `SYSTEM_ADMINISTRATOR` role | `SystemAdminGuard` |
| Cross-tenant billing access is forbidden | Every query scoped to userId or organizationId |

---

## Part 3 — Implementation Roadmap

### Phase 1 — Foundation (Current Priority)

**Admin Module**
- [ ] Create `admin` module with `SystemAdminGuard`
- [ ] Admin user management endpoints (view, suspend, reactivate)
- [ ] Admin organization management endpoints
- [ ] `ImpersonationLog` table + impersonation flow + JWT claim
- [ ] Admin audit log viewer

**Billing Schema**
- [ ] Add `Wallet` model to Prisma
- [ ] Add `WalletTransaction` model (immutable ledger)
- [ ] Add `UsageMeter` model
- [ ] Add `PlanQuota` model linked to `SubscriptionPlan`
- [ ] Add `BillingEvent` model
- [ ] Add `ImpersonationLog` model
- [ ] Add `FeatureFlag` + `FeatureFlagOverride` models
- [ ] Migrate existing `Subscription` model (keep, extend)

**Billing Services**
- [ ] `WalletService` — atomic balance reads/writes with idempotency
- [ ] `QuotaEnforcerService` — soft/hard/grace limit checks
- [ ] `UsageMeterService` — track current period usage
- [ ] `BillingEventService` — append-only event log
- [ ] `CostEngineService` — stub with initial AI credit mapping

### Phase 2 — Subscription Lifecycle

- [ ] `SubscriptionService` — create, upgrade, downgrade, cancel
- [ ] Subscription renewal worker (monthly reset of included credits)
- [ ] Payment provider adapter interface (`PaymentProviderInterface`)
- [ ] Stripe adapter implementation
- [ ] Webhook handler for Stripe events (subscription renewed, charge failed, etc.)
- [ ] Invoice creation on renewal
- [ ] Admin subscription management endpoints

### Phase 3 — Credits & Top-Ups

- [ ] Top-up packages CRUD (admin)
- [ ] Top-up purchase flow (customer)
- [ ] Coupon & promotion system
- [ ] Coupon redemption flow
- [ ] Auto-recharge configuration (per subscription)
- [ ] Bonus credit expiration worker
- [ ] Admin manual credit adjustment endpoint

### Phase 4 — Analytics & Monitoring

- [ ] MRR/ARR calculation service
- [ ] Credit burn rate dashboards
- [ ] Churn tracking
- [ ] Upgrade/downgrade rate tracking
- [ ] Feature flag management (admin)
- [ ] Usage analytics per org/user

---

## Open Questions

> These need Product Team answers before implementation begins.

1. **Payment Provider** — Stripe, Paddle, or custom? This affects the adapter implementation.
2. **Credit Pricing** — Exact credits per AI model call (GPT-4o vs Gemini vs Sonnet)?
3. **Operations Pricing** — Cost per node type (HTTP vs Code vs Database)?
4. **Overage Policy** — Do Pro/Scale plans allow overages with extra billing?
5. **Grace Period Duration** — How many days after hard limit before service suspension?
6. **Annual Plans** — Discount % for annual billing?
7. **Free Plan Restrictions** — Which features are hard-gated (no AI Credit equivalent)?
8. **BYOK (Bring Your Own Keys)** — If user provides own OpenAI key, do we still charge AI Credits?

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Credit storage | `BigInt` (not `Decimal`) | Avoid floating-point precision issues for fractional credits |
| Wallet mutation | Atomic DB transactions | Prevent race conditions on concurrent consumption |
| Billing events | Append-only | Regulatory compliance + full audit trail |
| Idempotency | Unique key on transactions | Prevent duplicate charges from retries |
| Cost abstraction | AI Credits + Operations | Customer-friendly, hides infra complexity |
| Admin access | `SYSTEM_ADMINISTRATOR` role + `SystemAdminGuard` | Clean separation from org-level admin |
| Payment provider | Behind interface | Swappable (Stripe today, Paddle tomorrow) |
