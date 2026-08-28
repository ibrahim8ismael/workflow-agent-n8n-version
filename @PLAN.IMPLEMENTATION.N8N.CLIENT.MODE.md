# IMPLEMENTATION PLAN — Jaafar Automation Model on Client-Managed n8n
> Version: 1.1 (Draft)
> Strategy doc: [[@PLAN.N8N.CLIENT.MODE.md]]
> Branch strategy: one PR per step; steps ordered by dependency.
>
> Scope: (A) remove Employee Design + Skills, **keep the entire Jaafar core**;
> (B) build Automation Design (Jaafar designs → user approves);
> (C) client-managed n8n connections + provisioning + execution.
>
> ## Progress log
> - ✅ Step 0 DONE — baseline green (552 tests); +5 characterization tests locking executor contract (`n8n-workflow-executor.service.spec.ts`, `tool-executor.service.spec.ts`); fixed pre-existing lint in `runs.service.ts`, `jaafar-runtime.service.*`. Deferred: production data audit (needs live DB).
> - ✅ Step 1 DONE — `infrastructure/crypto/secret-box.service.ts` (+7 tests); `CREDENTIAL_ENCRYPTION_KEY` added to config schema (optional until Step 11).
> - ✅ Step 2 DONE — `N8nConnection` / `N8nConnectionCredential` / `Automation` models + back-relations; migration `prisma/migrations/20260824000000_add_client_n8n_and_automations/migration.sql` (hand-written; **apply when DB reachable**); prisma generate OK. Amendment: `Automation.lastError` column added during Step 9 for provisioning failure surfacing.
> - ✅ Step 3 DONE — `infrastructure/n8n/n8n-client-api.service.ts`: verify/list/get/create/activate workflows, typed errors (INVALID_CREDENTIALS/UNREACHABLE/API_ERROR), SSRF guard (scheme allowlist, private-IPv4/IPv6 denylist w/ unsigned-int fix, DNS resolve, localhost exemption dev-only), webhook-path extraction; 15 tests.
> - ✅ Step 4 DONE — `modules/integrations/n8n/`: constants/Zod DTOs/repository/service/controller/module registered in app.module. Endpoints live under `/api/v1/integrations/n8n`. 6 service tests. RBAC note: currently mirrors IntegrationsController guards (Jwt+TenantAccess); org-role (Owner/Admin vs Member) enforcement to be tightened with Automations module.
> - ✅ Steps 5+6+7+8+9 DONE (one atomic unit) — Employee Design flow + Skills system removed; Automations module (`modules/automations/`: blueprint Zod schema w/ revision hash, lifecycle service, controller `/api/v1/automations`); `automation-design-session.service` + `jaafar-automation-design-graph.service` (LangGraph: load session → collect requirements → persist turn → approval interrupt → provision via AutomationsService); `n8n-provisioner.service` (blueprint → webhook + per-step Code skeletons + respondToWebhook, create+activate+read-back in client n8n); `POST runs/:id/confirm` → `confirmAutomationDesign` → graph resume → provisioning; route/mode renamed `employee_design` → `automation_design` across understanding/planner/graphs/tool manifests; `claimEmployeeCreation` → `claimAutomationCreation`; Jaafar prompts rewritten to automation narrative (tone rules preserved); legacy RuntimeService skill execution stripped (tools resolve via registry; automation resolution lands Step 10). 81 files / 545 tests green, typecheck + biome clean.
> - ⏳ Remaining: Step 10 (runtime tool resolution → automations + executor dual-read), Step 11 (config cleanup + delete `n8n-workflow-sync.service`, blocked on Open Q1), Steps 12–13 (test alignment, docs propagation).
> - ✅ Step 10 DONE — `N8nWorkflowExecutorService` accepts optional `binding{baseUrl,webhookPath,secret}` (per-binding HMAC, same signature scheme); env-global fallback kept as deprecated dual-read with boot warning. `AutomationToolResolverService` enumerates ACTIVE Automations joined to connections as n8n tools (30s TTL cache); tools carry `binding`; unusable connection → tool flagged `INTEGRATION_UNAVAILABLE` (retryable=false) surfaced to planner, no silent fallback. `ToolRegistryService.listForAgent` merges static + automation tools. `ToolExecutorService.runN8nWorkflow` passes binding / maps INTEGRATION_UNAVAILABLE. +7 tests.
> - ✅ Step 11 (unblocked parts) — `config/schema.ts`: `N8N_BASE_URL/WEBHOOK_URL/API_URL/API_KEY/WORKFLOW_MAP` marked @deprecated with boot warning (`validation.ts`); `CREDENTIAL_ENCRYPTION_KEY` required outside development/test. Migration script `scripts/migrate-skills-to-automations.ts` (dry-run default, `--write` to apply; skips skills without an ACTIVE owner connection). STILL BLOCKED on Open Q1: delete `n8n-workflow-sync.service.*` (Inbound Channel Gateway provisioning) + drop Skill/AgentSkill tables (post-staging-cutover).
> - ⏳ Remaining: Step 12 (e2e vertical-slice rewrite: connect → chat → blueprint → approve → provisioned → run executes via webhook mock), Step 13 (docs propagation), Open Q1 decision for sync-service deletion.

---

# Dependency Graph

```
Step 0   Baseline & guardrails
─ PART C-INFRA (additive, no behavior change)
Step 1   Crypto SecretBox ─────────────┐
Step 2   Prisma schema (new models) ─┐ │
Step 3   N8n Client API service ──┐  │ │
                                 ▼  ▼ ▼
Step 4   N8n Connections module
─ PART A (removal — Jaafar core untouched)
Step 5   Remove Employee Design flow
Step 6   Remove Skills system
─ PART B (new capability)
Step 7   Automation Blueprint schema + Automations module
Step 8   Automation Design session + Jaafar design graph      [needs 5,7]
Step 9   Approval wiring + Provisioner (push to client n8n)   [needs 3,4,8]
─ CUT OVER
Step 10  Runtime tool resolution → automations; executor dual-read [needs 6,9]
Step 11  Config cleanup + delete legacy sync service          [needs 10]
Step 12  Test alignment                                       [continuous]
Step 13  Docs & rules propagation                             [last]
```

---

# Step 0 — Baseline & Guardrails

- [ ] `npm test`, `npm run lint:ci`, `npm run typecheck` green on main.
- [ ] Characterization tests for the surviving contract: `tool-executor.service.ts` `runN8nWorkflow()` (~line 352) and `N8nWorkflowExecutorService` (envelope shape, HMAC headers, retry/backoff, timeout). These must keep passing through Steps 9–10.
- [ ] Record current Jaafar flows in tests: conversation run, understanding, approval gate (`jaafar-approval`), employee-design confirm — so Step 5 proves only design-flow removal breaks nothing else.
- [ ] Audit production data: runs with `metadata.employeeDesign`, existing Skill/AgentSkill rows (input to migration script in Step 12).

**Acceptance:** green baseline + contract tests committed before any deletion.

---

# PART C-INFRA — Additive Foundation

## Step 1 — Crypto Infrastructure

New: `src/infrastructure/crypto/secret-box.service.ts` (+ spec)

- [ ] AES-256-GCM `encrypt`/`decrypt`; random IV; key from `CREDENTIAL_ENCRYPTION_KEY` (base64/32B).
- [ ] Zod env validation (optional until Step 11).
- [ ] Tests: round-trip, tamper throws, no plaintext in logs.

## Step 2 — Prisma Schema + Migration

Files: `prisma/schema.prisma`, new migration.

- [ ] Add `N8nConnection`, `N8nConnectionCredential`, `Automation` exactly per strategy doc §3.
- [ ] Do NOT drop `Skill`/`AgentSkill` yet — mark `@deprecated` in comments; dropped post-cutover.
- [ ] Migrate locally vs pgvector; generate + typecheck green.

## Step 3 — N8n Client API Service

New: `src/infrastructure/n8n/n8n-client-api.service.ts` (+ spec)

```ts
verify(conn)                    // GET {base}/api/v1/workflows?limit=1 → ok/version
listWorkflows(conn)             // full list
getWorkflow(conn, id)           // detail incl. webhook nodes
createWorkflow(conn, payload)   // POST /workflows        ← used by provisioner
activateWorkflow(conn, id)      // POST /workflows/:id/activate
```

- [ ] `X-N8N-API-KEY` header; per-call timeout (`N8N_TIMEOUT_MS`).
- [ ] **SSRF guard**: https-only (http localhost dev-only), deny private CIDRs (`127/8`,`10/8`,`172.16/12`,`192.168/16`,`169.254/16`,`::1`), DNS resolve → IP re-check before fetch.
- [ ] Typed errors: `INVALID_CREDENTIALS` (401/403), `UNREACHABLE` (network/timeout), `API_ERROR`.
- [ ] Mocked-fetch unit tests incl. SSRF rejections.

## Step 4 — N8n Connections Module

New: `src/modules/integrations/n8n/` (standard structure: controllers/services/repositories/dto/constants)

Endpoints:
```
POST   /api/v1/integrations/n8n                register + verify → ACTIVE/INVALID
GET    /api/v1/integrations/n8n                list (keys masked sk-…abcd)
PATCH  /api/v1/integrations/n8n/:id            rotate/suspend/resume
DELETE /api/v1/integrations/n8n/:id            soft delete (automations → SUSPENDED)
POST   /api/v1/integrations/n8n/:id/verify     re-verify
GET    /api/v1/integrations/n8n/:id/workflows  list client's workflows
```

- [ ] Owner = User XOR Organization; RBAC Owner/Admin manage, Member/Viewer read.
- [ ] Create: validate URL → encrypt key → save PENDING_VERIFICATION → verify → ACTIVE.
- [ ] e2e: register→verify→rotate→delete; cross-owner access 403.

---

# PART A — Removal (Jaafar core stays)

## Step 5 — Remove Employee Design Flow ⏳ NEXT

**Surgery map (measured):** `jaafar-runtime.service.ts` (1126 lines) — imports L6/L22, ctor L43–45, route branches L130 & L367, `confirmEmployeeDesign` L607–676, graph invoke/resume L699–710 & L733–737, mappers L767+/L922+. Router: `runtime-router.service.ts` mode branch. Total design-flow LOC ≈ 2,340 across 7 files.

⚠️ Land Steps 5+8+9 as ONE unit — Jaafar must never be without a working design flow. Do not start 5 alone.

Delete:
```
src/modules/runtime/employee-design/*                       (runtime service, types, blueprint schema/validation, specs)
src/modules/runtime/services/employee-design-session.service.ts
src/modules/runtime/dto/confirm-employee-design.dto.ts      (+ spec)
```

Edit:
- `runtime/runtime.controller.ts`: replace `POST :id/confirm` employee payload with automation confirmation schema (full swap lands in Step 9; here: stub returning NotImplemented or wire minimal passthrough).
- `runs/runs.service.ts`: rename branch `metadata.employeeDesign` → `metadata.automationDesign` (~lines 134–139).
- `runtime/runtime.module.ts`: drop deleted providers.
- `channels-inbound.service.ts`: **unchanged** — still routes through `JaafarRuntimeService`.

⚠️ Keep `jaafar-employee-design-graph.service.ts` alive until Step 8 replaces it with the automation design graph (avoid dead window where confirm endpoint has no graph).

**Acceptance:** typecheck + suite green; Jaafar chat/planning/approval unaffected.

## Step 6 — Remove Skills System

Delete:
```
src/modules/skills/*                                        (entire module)
src/modules/runtime/skill/skill-employee-runtime.service.ts (+ spec)
```

Edit:
- `app.module`: remove `SkillsModule`.
- `runtime.module.ts` / `tool-executor.service.ts` / `tool-manifest.service`: strip skill-based tool sources (temporary gap acceptable — automation resolution lands in Step 10 behind flag).
- Grep cleanup: `SkillExecutionMode`, skill slugs in seeds/constants.

DB: none yet (`Skill` tables soft-deprecated until Step 12).

**Acceptance:** build green; runtime boots without skills; feature-flagged execution still OK via legacy path if kept temporarily.

---

# PART B — Automation Design (the new core)

## Step 7 — Blueprint Schema + Automations Module

New:
```
src/modules/automations/
  schemas/automation-blueprint.schema.ts     Zod: goal, trigger{type,config}, steps[{name,action,integration?,config}],
                                             integrations[required], inputContract, outputContract, riskNotes
  controllers/automations.controller.ts      GET list/detail, POST approve, DELETE, POST reprovision
  services/automations.service.ts            lifecycle: DESIGN→PENDING_APPROVAL→(approve)→PROVISIONING→ACTIVE/FAILED
  repositories/automations.repository.ts
  dto/*
constants: status enum
```

- [ ] Blueprint immutability after approval (version copy if revised).
- [ ] Ownership/RBAC same pattern as connections.

## Step 8 — Automation Design Session + Jaafar Design Graph

New (modeled on the removed employee-design pair):
```
src/modules/runtime/services/automation-design-session.service.ts    Redis state machine
src/modules/runtime/services/jaafar-automation-design-graph.service.ts  LangGraph loop
```

Flow inside the graph:
1. Intent = build automation (existing `jaafar-request-understanding` output).
2. Context via existing `jaafar-context-loader`: conversation + memory recall + **KB retrieval**.
3. Ask follow-ups for missing requirements (never guess).
4. Check required integrations exist in client's connected apps/n8n credentials (via Step 3 API) BEFORE proposing.
5. Emit validated `AutomationBlueprint` (Zod schema from Step 7).
6. Hand off to approval.

Edit:
- `infrastructure/prompts/modules/jaafar.prompt.ts`: rewrite narrative from "builds employees" → "designs automations" (keep [[@RULE.AGENT.Jaafar.md]] tone/vocabulary rules).
- Delete `jaafar-employee-design-graph.service.*` once parity reached.

**Acceptance:** conversational test: chat → follow-ups → blueprint JSON valid → session state persisted; KB content demonstrably grounds the blueprint.

## Step 9 — Approval Wiring + Provisioner

Approval:
- [ ] Reuse `jaafar-approval.service` gate: blueprint approval event → `AutomationsService.approve()` → status PROVISIONING.
- [ ] Enforce in service layer: provisioning code path reachable ONLY from approved blueprints.
- [ ] Wire `POST :id/confirm` (renamed semantics: approve automation) in runtime controller to this path.

Provisioner — new `src/infrastructure/n8n/n8n-provisioner.service.ts` (logic adapted from old sync service `createSkillWorkflow`, now per-client):
- [ ] Blueprint → workflow JSON: webhook node (path = automation id slug) → step nodes (start conservative: Code-node skeleton per step w/ TODO markers from blueprint) → respondToWebhook node.
- [ ] `createWorkflow` + `activateWorkflow` against the CLIENT's connection (decrypted key); capture `externalWorkflowId` + webhookPath into Automation row → status ACTIVE.
- [ ] Failure → status FAILED + lastError surfaced back into Jaafar chat for iteration.
- [ ] Delete `n8n-workflow-sync.service.*` boot-sync/global-env logic (file removed in Step 11).

**Acceptance:** e2e: chat → blueprint → approve → workflow visible+active in a mock n8n → Automation ACTIVE with webhookPath.

---

# CUT OVER

## Step 10 — Runtime Tool Resolution → Automations + Executor Dual-Read

- [ ] `tool-executor.service.ts` + `tool-manifest.service.ts`: tools enumerated from `Automation(status=ACTIVE)` joined to connection; registry resolves `{baseUrl, webhookPath}` (short-TTL cache).
- [ ] Connection not ACTIVE / missing → `INTEGRATION_UNAVAILABLE` (retryable=false) — planner reacts, no silent fallback.
- [ ] `N8nWorkflowExecutorService`: accept optional `binding{baseUrl,webhookPath,secret}`; fallback to env globals logs deprecation warning. Contract otherwise unchanged (Step 0 tests guard).
- [ ] Per-binding HMAC shared secret support (same signature scheme).

## Step 11 — Config Cleanup + Legacy Removal

- [ ] `config/schema.ts`: deprecate `N8N_BASE_URL/WEBHOOK_URL/API_URL/API_KEY/WORKFLOW_MAP` (warn at boot); require `CREDENTIAL_ENCRYPTION_KEY` outside dev; keep `N8N_TIMEOUT_MS/MAX_RETRIES`.
- [ ] Delete `n8n-workflow-sync.service.*` + references in `n8n.module.ts`. ⚠️ Blocked on Open Q1 (Inbound Channel Gateway provisioning).
- [ ] Migration script: existing `Skill(N8N_WORKFLOW)` rows → `Automation` records bound to owner's connection.
- [ ] Drop `Skill`/`AgentSkill` tables in a NEW migration (only after cutover verified in staging).

---

# Step 12 — Test Alignment

- [ ] Rewrite `n8n-vertical-slice.spec.ts`: connect n8n → chat with Jaafar (mock LLM) → blueprint → approve → provisioned (mock n8n REST) → Run executes via webhook mock end-to-end.
- [ ] Unit: blueprint schema validation, provisioner JSON generation, SSRF, crypto, catalog/binding caches.
- [ ] e2e: RBAC matrix + cross-tenant isolation on connections & automations.
- [ ] Jaafar regression suite: conversation, planning, memory policy, approval — prove core intact.
- [ ] `npm run test:e2e` green.

---

# Step 13 — Docs & Rules Propagation

Order: mother document first.
1. `@RULE.BUSINESS_MODEL.md` — automation model, runtime ownership.
2. `@RULE.AGENT.Jaafar.md` — vocabulary shift employee→automation (tone rules preserved).
3. `@RULE.ARCHITECTURE.md` / `@RULE.AGENT.N8N.CALL.md` — ADR-011: "Automations live in client-provided n8n instances; Jaafar designs, user approves, platform provisions".
4. New `@RULE.AUTOMATIONS.md`? (blueprint lifecycle, approval gate) — recommend yes.
5. `@RULE.SCOPE.md`, `@RULE.DB.md`, `@RULE.API.md`, `README.md`; mark both plans Implemented.

---

# Rollback Plan

- Steps 1–4 additive → revert independently.
- Part A deletions land AFTER Part B equivalents work behind a feature flag → cutover reversible by flag.
- Executor dual-read keeps env fallback until Step 11 explicitly removes it.
- DB drops are separate final migrations — never bundled earlier.

---

# Effort Estimate (rough, single dev)

| Step | Size |
|---|---|
| 0 | S |
| 1–4 | M each (4 is L with e2e) |
| 5–6 | M (untangling, not hard deletes) |
| 7 | M |
| 8 | L (LangGraph design loop + prompt work) |
| 9 | L (provisioner + approval enforcement) |
| 10–11 | M (11 blocked on Q1) |
| 12–13 | M |

Total ≈ 4–5 weeks incl. review cycles. Critical path: 0→3→4→8→9→10.
