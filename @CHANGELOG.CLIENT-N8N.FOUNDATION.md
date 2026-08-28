# CHANGELOG — Client-Managed n8n Foundation (Plan Steps 0–4)
> Branch: `feat/client-managed-n8n-foundation` (from `feat/jaafar-employee-design-and-n8n-runtime`)
> Date: 2026-08-24
> Plans implemented: [[@PLAN.N8N.CLIENT.MODE.md]] + [[@PLAN.IMPLEMENTATION.N8N.CLIENT.MODE.md]] Steps 0–4
> Status: Steps 0–4 complete. Next: Steps 5+8+9 (Employee Design removal + Automation Design) as one atomic unit.

---

# Summary

Foundation work for shifting n8n from a platform-owned engine to a **client-provided integration**: each client registers their own n8n instance via API key; later phases have Jaafar design automations that get provisioned into the client's instance after explicit user approval.

All existing behavior is preserved (581 tests green, typecheck + lint clean). Everything in this phase is additive except characterization tests and lint fixes.

---

# New Files

## Plans
| File | Purpose |
|---|---|
| `@PLAN.N8N.CLIENT.MODE.md` v1.0 | Strategy doc: target model, DB schema, API surface, execution flow, migration strategy, risks, open questions |
| `@PLAN.IMPLEMENTATION.N8N.CLIENT.MODE.md` v1.1 | Step-by-step implementation plan (14 steps, dependency graph) + progress log |

## Crypto (Step 1)
| File | Purpose |
|---|---|
| `src/infrastructure/crypto/secret-box.service.ts` | AES-256-GCM encryption for client secrets at rest. Wire format `base64(iv[12]‖authTag[16]‖ciphertext)`, random IV per call, key from env, tamper → generic error (no oracle). |
| `src/infrastructure/crypto/secret-box.service.spec.ts` | 7 tests: round-trip, random IV, tamper rejection, wrong-key rejection, truncated payload, unconfigured refusal, bad-key-length init error |

## n8n Client API (Step 3)
| File | Purpose |
|---|---|
| `src/infrastructure/n8n/n8n-client-api.service.ts` | Typed REST client for the CLIENT's n8n public API (`verify`, `listWorkflows`, `getWorkflow`, `createWorkflow`, `activateWorkflow`). Credentials per-call (no platform globals). SSRF guard: scheme allowlist, private IPv4/IPv6 denylist (unsigned-int safe), DNS resolution before connect, localhost exemption outside production. Typed errors: `INVALID_CREDENTIALS` (401/403), `UNREACHABLE` (network/DNS/timeout), `API_ERROR`. Static `extractWebhookPaths()` for binding automation→webhook. |
| `src/infrastructure/n8n/n8n-client-api.service.spec.ts` | 15 tests incl. mocked-DNS SSRF suite (private IPv4, metadata IP 169.254.x, private IPv6, public pass-through, http-to-non-localhost blocked in prod, loopback allowed in dev but blocked in prod) |

## Connections Module (Step 4)
| File | Purpose |
|---|---|
| `src/modules/integrations/n8n/constants/n8n-connection.constants.ts` | Connection status enum (`PENDING_VERIFICATION / ACTIVE / INVALID / SUSPENDED`) |
| `src/modules/integrations/n8n/dto/n8n-connection.dto.ts` | Zod DTOs: create (name/baseUrl/apiKey), update (rename/rotate/suspend) |
| `src/modules/integrations/n8n/repositories/n8n-connections.repository.ts` | Only Prisma access point; owner-scoped queries (User XOR Organization), credential upsert/get |
| `src/modules/integrations/n8n/services/n8n-connections.service.ts` | Lifecycle: create→encrypt key→verify→ACTIVE/INVALID; transient network failure keeps prior status; key rotation re-verifies; masked key previews (`…last4`) — raw keys never leave the service except via `resolveCredentials()` (ACTIVE-only); soft delete |
| `src/modules/integrations/n8n/controllers/n8n-connections.controller.ts` | `POST/GET/PATCH/DELETE /api/v1/integrations/n8n[/:id]`, `POST /:id/verify`; acting-context scope resolution (never trusts body org IDs) |
| `src/modules/integrations/n8n/services/n8n-connections.service.spec.ts` | 6 tests: create+verify+mask, INVALID on bad key, transient-failure retention, owner-scope 404, encryption-required guard, ACTIVE-only credential resolution |
| `src/modules/integrations/n8n/n8n-connections.module.ts` | Feature module wiring |

## Database (Step 2)
| File | Purpose |
|---|---|
| `prisma/migrations/20260824000000_add_client_n8n_and_automations/migration.sql` | Creates `n8n_connections`, `n8n_connection_credentials`, `automations` tables + indexes/FKs. Hand-written following init-migration conventions (⚠️ apply against live DB: `npm run prisma:migrate`) |

---

# Modified Files

| File | Change | Why |
|---|---|---|
| `prisma/schema.prisma` | Added models `N8nConnection`, `N8nConnectionCredential`, `Automation` (+ back-relations on `User`/`Organization`). Additive only — no existing model touched. | Plan §3 |
| `src/app.module.ts` | Import + register `N8nConnectionsModule` | Expose connections API |
| `src/config/schema.ts` | Added optional `CREDENTIAL_ENCRYPTION_KEY` (base64, must decode to exactly 32 bytes) | SecretBox key source; becomes required at Step 11 |
| `src/infrastructure/n8n/n8n-workflow-executor.service.spec.ts` | +3 characterization tests locking the executor contract before future refactor: retry-with-backoff on HTTP 500 then succeed, no-retry on 400 (asserts call count), network errors retryable until exhaustion | Step 0 guard-rail |
| `src/modules/runtime/services/tool-executor.service.spec.ts` | +2 characterization tests: n8n-mode tool routes through executor with slug/input/stable idempotency key; non-retryable N8nWorkflowError surfaces as failed result without retries | Step 0 guard-rail |

# Lint fixes (pre-existing issues, format/import-order only — no logic)

- `src/modules/runs/runs.service.ts`
- `src/modules/runtime/services/jaafar-runtime.service.ts` ⚠️ *also contains pre-existing uncommitted feature work from the previous branch — not part of this change*
- `src/modules/runtime/services/jaafar-runtime.service.spec.ts` ⚠️ *same caveat*

---

# Verification

```
npm run typecheck   ✅
npm test            ✅ 81 files / 581 passed (was 78/552 at start)
npm run lint:ci     ✅ 455 files clean
```

# Not done yet (per plan)

- Steps 5+8+9 as one atomic unit: remove Employee Design flow + build Automation Design graph + approval/provisioner wiring (surgery map documented in implementation plan)
- Step 6: Skills system removal · Steps 7–13: blueprint module, provisioner, runtime cutover, config cleanup, sync-service deletion, docs propagation
- Migration SQL needs applying to a reachable Postgres
