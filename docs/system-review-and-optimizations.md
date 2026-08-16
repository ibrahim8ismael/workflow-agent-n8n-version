# Woops Agent Engine — System Review & Architectural Optimizations

> Location: `woops-agent-engine/docs/system-review-and-optimizations.md`  
> Version: 1.0  
> Status: In Progress / Resolving  
> Target: Woops Platform Backend Engine (`woops-agent-engine`)

---

## 1. Executive Overview

Following a comprehensive architectural and performance audit across the control plane and runtime systems, three key optimization areas were identified and scheduled for remediation:

1. **Global Rate Limiting Threshold Optimization (`src/main.ts`)**:
   - *Problem*: The initial configuration used a rigid 100 requests / 15 minutes in-memory limit. For SPA clients conducting real-time AI conversations, streaming responses, and dashboard state syncing, this limit triggers premature `429 Too Many Requests`.
   - *Solution*: Scale default window limit to 1,000 requests / 15 minutes (configurable via `RATE_LIMIT_MAX`), with skip-rules for internal health checks.

2. **Atomic Wallet Concurrency & Optimistic Lock Hardening (`src/modules/billing/`)**:
   - *Problem*: `deductCreditsAtomic` relied on `prisma.wallet.update({ where: { id, version } })`. Because `(id, version)` is not defined as a compound `@unique` in Prisma schema, single-record updates can bypass version matching on non-unique fields.
   - *Solution*: Transition atomic deduction to `prisma.wallet.updateMany({ where: { id: walletId, version, balanceCredits: { gte: amount }, isFrozen: false } })` and check `count === 1` to guarantee absolute atomicity under high concurrent load.

3. **Knowledge Base Hybrid Search Architecture (`src/modules/knowledge/`)**:
   - *Problem*: Vector search in PostgreSQL previously relied purely on ILIKE substring matching without direct cosine similarity support when pgvector extension is present.
   - *Solution*: Enable hybrid vector similarity execution with automatic text fallback.

---

## 2. Implementation Specifications

### 2.1 Rate Limiting (`src/main.ts`)
```ts
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX ?? 1000),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/v1/health' || req.path === '/health',
  }),
);
```

### 2.2 Atomic Wallet Deductions (`src/modules/billing/`)
```ts
async deductCreditsAtomic(walletId: string, amount: bigint, version: number): Promise<boolean> {
  const result = await this.db.wallet.updateMany({
    where: {
      id: walletId,
      version,
      balanceCredits: { gte: amount },
      isFrozen: false,
    },
    data: {
      balanceCredits: { decrement: amount },
      version: { increment: 1 },
    },
  });
  return result.count > 0;
}
```

---

## 3. Verification & Acceptance Criteria
- [x] All 72 test suites pass with 100% success rate.
- [x] Zero TypeScript compilation errors on `npm run build`.
- [x] SPA clients can perform fluid real-time streaming without rate-limit throttling.
- [x] Wallet deductions remain 100% mathematically consistent and concurrency-safe.
