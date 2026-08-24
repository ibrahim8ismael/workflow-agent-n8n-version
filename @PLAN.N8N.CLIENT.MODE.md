# PLAN — Jaafar Automation Model on Client-Managed n8n
> Version: 1.0 (Draft — for review, **no code changed yet**)
> Replaces: previous "client-built workflows" interpretation
> Parent: [[@RULE.BUSINESS_MODEL.md]]
> Affected rules: [[@RULE.AGENT.Jaafar.md]], [[@RULE.ARCHITECTURE.md]], [[@RULE.SCOPE.md]], [[@RULE.DB.md]]

---

# 1. The New Model

## Business flow (B2B)

```
Client signs up (Organization)
        │
        ▼
Adds Knowledge Bases ──────────┐
Connects their n8n (API key)   │
        │                      │
        ▼                      ▼
Talks to Jaafar ◄─────── chat + memory + KBs context
        │
        ▼
Jaafar designs an AUTOMATION (not an employee)
  • clear plan: goal, trigger, steps, integrations used
        │
        ▼
User APPROVES the design          ← explicit human gate
        │
        ▼
Woops pushes the workflow into THE CLIENT'S n8n (via their API key)
        │
        ▼
Agent Runs execute the automation through n8n webhooks
```

## What changed vs the old model

| | Old (removed) | New |
|---|---|---|
| Unit of work | **Employee** (Employee Design) | **Automation** (Automation Design) |
| Where it lives | Woops platform entities | **Client's own n8n instance** |
| Who authors it | Jaafar generates employee + skills in-platform | Jaafar designs → approves → pushed to client's n8n |
| Capabilities model | Skills (`Skill` / `AgentSkill`) | Automations bound to n8n workflows |
| Runtime ownership | Platform n8n | Client n8n (API-key connected) |

## What STAYS (Jaafar core — untouched)

The entire Jaafar conversational/runtime stack remains:

- `jaafar-runtime.service`, `jaafar-conversation-graph`, `jaafar-understanding-graph`
- `jaafar-planning`, `jaafar-execution-graph`, `jaafar-final-response`
- `jaafar-context-loader` (feeds chat + **memory + KBs** into design), `jaafar-memory-policy`
- `jaafar-approval` (the human-approval gate is reused for automation approval), `jaafar-idempotency`
- `jaafar-harness`, `jaafar-event-normalizer`, LangGraph infrastructure
- `RuntimeService` + `tool-executor.service` execution path

---

# 2. Component Changes

## ❌ Removed: Employee Design

```
src/modules/runtime/employee-design/*                    (design runtime, types, spec)
src/modules/runtime/dto/confirm-employee-design.dto.ts   (+ spec)
src/modules/runtime/schemas/jaafar-employee-design…      (if separate)
POST :id/confirm endpoint semantics                      (replaced by automation confirm)
runs.service.ts metadata.employeeDesign branch           (~line 134)
```

## ❌ Removed: Skills system

```
src/modules/skills/*                     (module, CRUD, controllers, repositories)
src/modules/runtime/skill/skill-employee-runtime.service.ts (+ spec)
prisma: Skill, AgentSkill models         (deprecate → drop after migration window)
infrastructure/tools tool manifests keyed by skill slug → replaced by automations
```

## ♻️ Replaced: Employee Design → **Automation Design**

New flow inside Jaafar (same conversational pattern, new artifact):

```
Chat turn
  ↓
jaafar-request-understanding (existing) → intent: build automation
  ↓
AutomationDesignSession (new — replaces EmployeeDesignSession)
  • context = conversation + memory recall + KB retrieval (existing context-loader)
  • gathers missing requirements, asks follow-ups (never guesses)
  ↓
AutomationBlueprint (new schema — replaces employee-blueprint)
  • goal, trigger type, steps[], required integrations (e.g. gmail, sheets),
    input/output contract, risk notes
  ↓
jaafar-approval (EXISTING service) → user approves explicitly
  ↓
AutomationProvisioner (new)
  • blueprint → n8n workflow JSON (webhook node + logic nodes + respond node)
  • POST to CLIENT's n8n: {connection.baseUrl}/api/v1/workflows  (X-N8N-API-KEY)
  • activate + capture production webhook path
  ↓
Automation record persisted (bound to connection + externalWorkflowId)
```

## ❌→♻️ Old global sync service

`n8n-workflow-sync.service.ts` is not simply deleted — its workflow-generation logic is **extracted and rebuilt** as the per-client `AutomationProvisioner`. Deleted parts: boot-time auto-sync, hardcoded default skills, querying all `Skill` rows, global env credentials.

---

# 3. Database Changes (Prisma)

## Removed (deprecate first, drop in later migration)
- `Skill`, `AgentSkill` (+ `SkillExecutionMode` enum usage)

## New

```prisma
model N8nConnection {
  id             String   @id @default(uuid())
  name           String
  baseUrl        String
  status         String   @default("PENDING_VERIFICATION")
  lastVerifiedAt DateTime?
  lastError      String?
  metadata       Json?
  userId         String?
  organizationId String?                    // exactly one populated
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?
  credential     N8nConnectionCredential?
  automations    Automation[]

  @@index([userId]) @@index([organizationId]) @@index([status])
  @@map("n8n_connections")
}

model N8nConnectionCredential {
  id            String @id @default(uuid())
  connectionId  String @unique
  encryptedData String                              // AES-256-GCM apiKey
  connection    N8nConnection @relation(fields:[connectionId], references:[id], onDelete: Cascade)
  @@map("n8n_connection_credentials")
}

model Automation {
  id                 String   @id @default(uuid())
  name               String
  description        String?
  blueprint          Json                          // approved AutomationBlueprint (immutable after approval)
  status             String   @default("DESIGN")
  // DESIGN | PENDING_APPROVAL | PROVISIONING | ACTIVE | FAILED | SUSPENDED
  connectionId       String
  externalWorkflowId String?
  webhookPath        String?
  lastSyncedAt       DateTime?
  userId             String?
  organizationId     String?                       // exactly one populated
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?
  connection         N8nConnection @relation(fields:[connectionId], references:[id])

  @@index([organizationId]) @@index([userId]) @@index([status])
  @@map("automations")
}
```

Notes:
- Design sessions stay out of Prisma (parity with employee design: session state in Redis); only the **approved blueprint** persists in `Automation.blueprint`.
- Agent execution resolves tools from `Automation` (status ACTIVE), not skills.

---

# 4. Code Edits (file-by-file)

## New

| File | Purpose |
|---|---|
| `src/modules/automations/` (full module) | CRUD + lifecycle: `controllers/ services/ repositories/ dto/ schemas/` |
| `.../schemas/automation-blueprint.schema.ts` | Zod blueprint: goal, trigger, steps[], integrations[], io contract |
| `src/modules/runtime/services/jaafar-automation-design-graph.service.ts` | LangGraph design loop (built from `jaafar-employee-design-graph` pattern) |
| `src/modules/runtime/services/automation-design-session.service.ts` | Session state machine (Redis), replaces employee-design-session |
| `src/infrastructure/n8n/n8n-provisioner.service.ts` | Blueprint → workflow JSON → push/activate in client's n8n (logic adapted from old sync service) |
| `src/infrastructure/n8n/n8n-client-api.service.ts` | Typed REST client (list/get/verify/create/activate workflows) with SSRF guard |
| `src/infrastructure/crypto/secret-box.service.ts` | AES-256-GCM for API keys |

## Modified

| File | Change |
|---|---|
| `modules/runtime/runtime.module.ts` | Remove employee-design providers; add automation-design providers |
| `modules/runtime/runtime.controller.ts` | Replace `POST :id/confirm` (employee) with automation confirmation payload/schema |
| `modules/runtime/runs…/runs.service.ts` | `metadata.employeeDesign` branch → `metadata.automationDesign` |
| `modules/channels/services/channels-inbound.service.ts` | Unchanged routing (still via JaafarRuntimeService ✔) |
| `modules/runtime/services/tool-executor.service.ts` | Tools resolve from **Automations**; `runN8nWorkflow()` passes `{baseUrl, webhookPath}` from automation↔connection; pre-check connection ACTIVE → else `INTEGRATION_UNAVAILABLE` |
| `infrastructure/prompts/modules/jaafar.prompt.ts` | Employee-building narrative → automation-building narrative (per [[@RULE.AGENT.Jaafar.md]] tone rules) |
| `infrastructure/n8n/n8n.module.ts` | Swap sync service for provisioner + client-api |
| `config/schema.ts` | Deprecate `N8N_BASE_URL/WEBHOOK_URL/API_URL/API_KEY/WORKFLOW_MAP`; add `CREDENTIAL_ENCRYPTION_KEY`; keep timeout/retries defaults |
| `app.module` | Swap `SkillsModule` → `AutomationsModule` |

## Deleted

```
src/modules/skills/*
src/modules/runtime/employee-design/*
src/modules/runtime/skill/*
src/modules/runtime/dto/confirm-employee-design.dto.* 
src/modules/runtime/services/employee-design-session.service.ts
src/infrastructure/n8n/n8n-workflow-sync.service.*        (logic moved to provisioner)
```

## Kept untouched
All other `jaafar-*` services, LangGraph infra, `RuntimeService`, executor envelope/retry/HMAC contract.

---

# 5. API Surface

```
# Connections (client's n8n)
POST   /api/v1/integrations/n8n                      register + verify (API key)
GET    /api/v1/integrations/n8n                      list (masked keys)
PATCH  /api/v1/integrations/n8n/:id                  rotate / suspend / resume
DELETE /api/v1/integrations/n8n/:id                  soft delete
POST   /api/v1/integrations/n8n/:id/verify           re-verify
GET    /api/v1/integrations/n8n/:id/workflows        list client's existing workflows

# Automations (designed by Jaafar)
GET    /api/v1/automations                           list (incl. DESIGN drafts)
GET    /api/v1/automations/:id                       detail + blueprint + health
POST   /api/v1/automations/:id/approve               approve design → triggers provisioning
DELETE /api/v1/automations/:id                       soft delete
POST   /api/v1/automations/:id/reprovision           re-push blueprint to n8n (drift repair)
```

Conversation-driven design happens through the existing Jaafar chat endpoints (no new REST surface needed there).

---

# 6. Execution Flow After the Change

```
Run step (tool = automation)
  ↓
Resolve: Automation (ACTIVE) → N8nConnection (ACTIVE) → decrypted creds
  ↓ MISSING/SUSPENDED → INTEGRATION_UNAVAILABLE (structured error to planner)
  ↓
POST {connection.baseUrl}/webhook/{automation.webhookPath}
     headers: HMAC signature/timestamp (per-automation shared secret) [+ Idempotency-Key]
     body: same envelope as today (runId, input, metadata…)   ← contract UNCHANGED
  ↓
Retry/backoff/timeout identical to current executor
  ↓
Result → response generation → memory → Run completes
```

---

# 7. Migration Strategy

1. Ship additive pieces first (crypto, connections, client-api, automations module skeleton).
2. Build Automation Design + Provisioner behind feature flag; employee flow still live until cutover.
3. Migrate any existing Skills → Automations records (script: skill w/ N8N_WORKFLOW mode → Automation bound to owner's connection).
4. Cut over runtime tool resolution to automations; flip flag off for employee design.
5. Soft-delete `Skill`/`AgentSkill` tables (drop in a later release).
6. Remove legacy env fallbacks.

---

# 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SSRF via client `baseUrl` | https-only (localhost dev excepted), private-CIDR denylist, DNS resolve + IP re-check |
| API keys at rest | AES-256-GCM `SecretBoxService`; masked responses; never logged |
| Generated workflow fails in client n8n | Provisioner validates via dry-run/read-back; `FAILED` status + surface error to Jaafar chat for iteration |
| Client edits/deletes generated workflow (drift) | Periodic re-verification job; drift detected → mark SUSPENDED + notify; `reprovision` endpoint repairs |
| Blueprint quality (hallucinated steps/integrations) | Blueprint schema validation + integration-availability check against client's connected apps BEFORE asking user to approve |
| Approval bypass | Reuse existing `jaafar-approval` gate — provisioning code path reachable ONLY post-approval (enforced in service layer, not UI) |
| Inbound Channel Gateway (old sync auto-provisioned it) | Decide: keep platform-n8n solely for gateway OR ship template for client instances (Open Q1) |
| Losing Skills domain concepts from rules docs | Update rule set in final PR |

---

# 9. Open Questions

1. **Inbound Channel Gateway**: keep platform-n8n just for it, or ship installable template to client instances?
2. Can users manually edit Jaafar-generated workflows in their own n8n editor afterwards? (Affects drift policy strictness.)
3. One automation = one n8n workflow, 1:1? (Recommended for v1.)
4. Do Free-tier clients without n8n get AI_ONLY conversations only?
5. Does the client need to pre-connect third-party apps (Gmail/Sheets) in their n8n before approving a blueprint that uses them — do we check and prompt?

---

# 10. Definition of Done

- Client registers n8n connection → talks to Jaafar → he designs an automation grounded in chat/memory/KBs → user approves → workflow appears ACTIVE in the client's n8n → agent Run executes it end-to-end.
- Employee-design and Skills fully removed from code and DB (soft-deprecated tables aside).
- No platform-owned n8n requirement (except resolved Open Q1 outcome).
- Rule documents updated (Jaafar marketing doc vocabulary already says "employees" — decide whether to reword to "automations").
