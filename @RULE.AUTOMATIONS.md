---
tags:
  - woops
  - automations
  - n8n
  - business-model
aliases:
  - Automations Rules
  - Automation Model
  - Client n8n
---

# Woops Automations — Client-Managed n8n Model
> Automation lifecycle, approval gate, provisioning & execution rules
>
> Version: 1.0
> Mother document: [[@RULE.BUSINESS_MODEL.md]]
> Connected: [[@RULE.AGENT.Jaafar.md]] · [[@RULE.AGENT.N8N.CALL.md]] · [[@RULE.ARCHITECTURE.md]] · [[@RULE.DB.md]] · [[@RULE.API.md]]
> ADR-011: Automations live in client-provided n8n instances; Jaafar designs, the user approves, the platform provisions.

---

# 1. The Model

Woops does **not** own an n8n runtime for customer automations. Each client
(User or Organization) registers **their own n8n instance** via API key.
Jaafar designs automations conversationally; nothing is provisioned without
an explicit human approval.

```
Client signs up (User | Organization)
        │
Adds Knowledge Bases ──────────┐
Connects their n8n (API key)   │
        │                      ▼
Talks to Jaafar ◄──── chat + memory + KBs context
        │
Jaafar designs an AUTOMATION (blueprint: goal, trigger, steps, integrations)
        │
User APPROVES the design          ← explicit human gate
        │
Woops pushes the workflow into THE CLIENT'S n8n (their API key)
        │
Agent Runs execute the automation through the client's n8n webhooks
```

## What was replaced (ADR-011)

| | Old (removed) | New |
|---|---|---|
| Unit of work | Employee (Employee Design) | Automation (Automation Design) |
| Where it lives | Woops platform entities | Client's own n8n instance |
| Capabilities | Skills (`Skill`/`AgentSkill`) | Automations bound to n8n workflows |
| Runtime | Platform-owned n8n | Client-provided n8n (API-key connected) |

The Jaafar conversational core (understanding, planning, execution, memory,
approval, idempotency) is unchanged.

---

# 2. n8n Connections

- A connection binds `{name, baseUrl, apiKey}` to exactly one owner
  (User XOR Organization).
- API keys are encrypted at rest with AES-256-GCM (`SecretBoxService`,
  `CREDENTIAL_ENCRYPTION_KEY`, required outside development). Raw keys never
  leave the service layer; API responses show a masked preview (`…last4`).
- Lifecycle: `PENDING_VERIFICATION → ACTIVE | INVALID`, plus `SUSPENDED` and
  soft delete. Verification re-runs against the client instance; transient
  network failures retain the prior status.
- All outbound calls pass the SSRF guard: https-only (http localhost
  dev-only), private IPv4/IPv6 denylist, DNS resolution + IP re-check.
- REST surface: `/api/v1/integrations/n8n`
  (`POST` register+verify, `GET` list, `PATCH` rotate/suspend, `DELETE` soft
  delete, `POST :id/verify`, `GET :id/workflows`).
- ⚠️ Route registration: the connections controller is declared inside
  `IntegrationsModule` *before* the legacy `@Controller('integrations')` so
  its literal paths are not shadowed by `@Get(':id')` wildcards.

---

# 3. Automation Blueprint

An `AutomationBlueprint` is a Zod-validated artifact Jaafar produces:

- `goal`, `trigger {type: webhook|schedule|manual|chat, config}`, ordered
  `steps[]` (name, action, optional integration + config), `integrations[]`,
  `inputContract`, `outputContract`, `riskNotes`
- `ready` + `missingRequirements` — Jaafar never guesses missing business
  facts; he asks follow-ups instead
- A `blueprintRevision` (stable content hash) marks each version

Rules:

1. Blueprints are **immutable after approval**. Revisions create a new version.
2. Jaafar only proposes integrations the client has connected or confirmed.
3. Design session state lives in run/conversation metadata (not Prisma);
   only the **approved blueprint** persists in `Automation.blueprint`.

---

# 4. Lifecycle & Approval Gate

```
DESIGN → PENDING_APPROVAL → PROVISIONING → ACTIVE
                                │
                                └──→ FAILED (lastError surfaced back into Jaafar chat)
SUSPENDED (connection lost/deleted) — repairable via reprovision
```

- **Provisioning is reachable ONLY through `approve()`/`reprovision()`** —
  enforced in the service layer, never just the UI. A blueprint in
  `DESIGN` cannot be provisioned.
- Approval reuses the Jaafar human-approval gate: the design graph
  interrupts (`await_approval`) and only resumes on explicit user
  confirmation (`POST /api/v1/runs/:id/confirm`).
- REST surface: `/api/v1/automations`
  (`POST` create-from-blueprint, `GET` list/detail, `POST :id/approve`,
  `POST :id/reprovision`, `DELETE` soft delete).

---

# 5. Provisioning (client n8n)

`N8nProvisionerService` converts the blueprint into workflow JSON:

- webhook node (path = automation slug) → one Code-node skeleton per step
  (TODO markers from the blueprint) → respondToWebhook node
- `createWorkflow` + `activateWorkflow` against the CLIENT's connection
  (decrypted `X-N8N-API-KEY`)
- Read-back captures `externalWorkflowId` + effective `webhookPath` into the
  Automation row → status `ACTIVE`
- Failure → status `FAILED` + `lastError`, surfaced back into Jaafar chat so
  the user can iterate

---

# 6. Execution

Agent runs resolve tools from `Automation(status=ACTIVE)` joined to its
connection:

- `AutomationToolResolverService` enumerates automation tools with a
  short-TTL cache (30s). Each tool carries its binding
  `{baseUrl, webhookPath, secret?}`.
- Connection not ACTIVE / missing → the tool is flagged
  `INTEGRATION_UNAVAILABLE` (retryable=false) so the **planner reacts — no
  silent fallback**.
- `N8nWorkflowExecutorService` targets `{baseUrl}/webhook/{webhookPath}` with
  the execution envelope (runId, input, metadata), `Idempotency-Key`, and
  HMAC-SHA256 signing. Per-binding shared secrets use the same signature
  scheme; the deprecated platform-global env path remains as a dual-read
  fallback until the cutover completes (boot warning logged).
- Drift policy: `reprovision` re-pushes the stored blueprint to repair drift
  in the client instance.

---

# 7. Security Invariants

1. Client API keys are encrypted at rest; masked in every API response;
   never logged.
2. Provisioning requires an explicit human approval event — enforced in the
   service layer.
3. Every client `baseUrl` passes the SSRF guard before any request.
4. Cross-owner access is impossible: every query is owner-scoped
   (User XOR Organization), 404 — not 403 — for foreign resources.
5. The envelope/HMAC/idempotency contract of the executor is unchanged;
   characterization tests lock it.

---

# 8. Open Questions (from @PLAN.N8N.CLIENT.MODE.md)

1. Inbound Channel Gateway provisioning (blocks legacy sync-service removal).
2. May users manually edit Jaafar-generated workflows in their n8n editor?
   (affects drift policy strictness)
3. Free-tier clients without n8n → AI_ONLY conversations only?
4. Pre-connection check for third-party apps inside the client's n8n before
   blueprint approval?

---

### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]]
- **Siblings:** [[@RULE.AGENT.Jaafar.md]] | [[@RULE.AGENT.N8N.CALL.md]] | [[@RULE.ARCHITECTURE.md]]
