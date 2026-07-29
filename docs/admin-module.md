---
type: reference
project: woops
tags: [admin, billing, reference, api]
updated: 2026-07-29
related: [[2026-07-29-billing-admin-implementation]], [[04-tech-stack]]
---

# Admin Module — Full Reference

All routes are under `/api/v1/admin/`. Protected by `JwtAuthGuard` + `SystemAdminGuard` (requires `role: SYSTEM_ADMINISTRATOR`).

---

## 1. Users

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/users` | List all users (paginated, with session/org/agent counts) |
| `GET` | `/admin/users/stats` | Total, active, suspended counts |
| `GET` | `/admin/users/:id` | Get user profile + aggregate counts |
| `POST` | `/admin/users/:id/suspend` | Suspend user (soft-delete + increment tokenVersion + revoke sessions) |
| `POST` | `/admin/users/:id/reactivate` | Reactivate suspended user |
| `POST` | `/admin/users/:id/impersonate` | Generate impersonation JWT (audited) |

### Impersonation Flow
1. Admin calls `POST /admin/users/:id/impersonate` with `{ reason: string }`
2. Record created in `impersonation_logs` (adminId, targetUserId, reason, timestamp)
3. Short-lived JWT issued with `{ sub: targetUserId, impersonatedBy: adminId, isImpersonation: true }`
4. All actions taken with this token are traceable to the impersonation log
5. `endedAt` set when impersonation session ends

---

## 2. Organizations

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/organizations` | List all orgs (paginated, with member/agent/apiKey counts) |
| `GET` | `/admin/organizations/stats` | Total org count |
| `GET` | `/admin/organizations/:id` | Get org detail + subscription info |
| `POST` | `/admin/organizations/:id/suspend` | Soft-delete org |

---

## 3. Subscriptions

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/subscriptions` | List all subscriptions (paginated, with plan) |
| `GET` | `/admin/subscriptions/stats` | Counts by status + total revenue |
| `GET` | `/admin/subscriptions/:id` | Get subscription + recent invoices |
| `PATCH` | `/admin/subscriptions/:id` | Change plan (body: `{ planId }`) |
| `POST` | `/admin/subscriptions/:id/cancel` | Force-cancel subscription |

---

## 4. Wallet / Credit Management

| Method | Route | Action |
|--------|-------|--------|
| `POST` | `/admin/wallets/:id/top-up` | Add credits (body: `{ credits, description }`) |
| `POST` | `/admin/wallets/:id/deduct` | Deduct credits (body: `{ credits, description }`) |
| `POST` | `/admin/wallets/:id/freeze` | Freeze wallet (blocks all consumption) |
| `POST` | `/admin/wallets/:id/unfreeze` | Unfreeze wallet |

---

## 5. Subscription Plans

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/plans` | List all plans (with quota) |
| `POST` | `/admin/plans` | Create plan (body: `{ tier, name, price, ... }`) |
| `PATCH` | `/admin/plans/:id` | Update plan (body: `{ name?, price?, isActive?, ... }`) |

---

## 6. Coupons & Promotions

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/coupons` | List all coupons (paginated) |
| `POST` | `/admin/coupons` | Create coupon (body: `{ code, type, value, maxRedemptions?, expiresAt? }`) |
| `PATCH` | `/admin/coupons/:id` | Update coupon |

**Coupon Types:** `PERCENTAGE`, `FIXED_AMOUNT`, `FREE_CREDITS`, `FREE_OPERATIONS`

---

## 7. Feature Flags

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/feature-flags` | List all flags (with overrides) |
| `GET` | `/admin/feature-flags/:key` | Get flag by key |
| `POST` | `/admin/feature-flags` | Create flag |
| `PATCH` | `/admin/feature-flags/:key` | Update flag (enable/disable globally) |
| `POST` | `/admin/feature-flags/:key/overrides` | Set per-entity override (body: `{ entityType, entityId, enabled }`) |
| `DELETE` | `/admin/feature-flags/:key/overrides` | Remove per-entity override |

**Override entity types:** `user`, `organization`, `plan`

---

## 8. Analytics

| Method | Route | Returns |
|--------|-------|---------|
| `GET` | `/admin/analytics/dashboard` | All metrics in one response |
| `GET` | `/admin/analytics/mrr` | Monthly Recurring Revenue + ARR |
| `GET` | `/admin/analytics/churn` | Churn rate (default: last 90 days) |
| `GET` | `/admin/analytics/credits-burn-rate` | Total + daily credits consumed (default: 30 days) |
| `GET` | `/admin/analytics/arpu` | Average Revenue Per User |

### Metrics Calculated
- **MRR**: Sum of active subscription plan prices
- **ARR**: MRR × 12
- **ARPU**: MRR / active customers
- **Churn Rate**: Canceled subs in period / active at period start
- **Burn Rate**: Total CONSUMPTION transactions in N days

---

## 9. Audit Logs

| Method | Route | Action |
|--------|-------|--------|
| `GET` | `/admin/audit-logs` | System audit log (filterable by action/user/entity) |
| `GET` | `/admin/audit-logs/impersonations` | Impersonation history (adminId, targetUserId, reason, timestamps) |

Audit logs are write-only — no delete or update endpoints exist.

---

## Security Model

```
Request
  → JwtAuthGuard (validates JWT, attaches user)
  → SystemAdminGuard (checks role === 'SYSTEM_ADMINISTRATOR')
  → Controller
```

- Cross-tenant access is forbidden: every query is scoped
- Impersonation is fully audited with no deletion capability
- No admin endpoint deletes data — only soft-deletes or suspends
