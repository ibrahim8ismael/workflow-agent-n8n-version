# Jaafar Native-Node Selection Fix — Implementation Plan (Final)

## 0. Goal & Constraints

### Goal

Jaafar must build automations using the **capabilities actually available in the user's connected n8n instance**.

The user owns and operates their n8n instance. Jaafar does not:

- own / host / modify the user's n8n installation
- access the n8n filesystem
- assume a specific n8n deployment type (Cloud / self-hosted / customized)
- assume every node supported by n8n exists in the user's instance

> **The connected n8n instance is the source of truth for node availability.**

### Current problem

Jaafar frequently generates generic implementations such as:

```text
Webhook → Code
```

or:

```text
HTTP Request → API
```

even when the connected instance provides a native node (WhatsApp, HubSpot, Zoho, Shopify, Gmail, Slack).

### Target behavior

```text
Native node available in THIS n8n + operation verified → Native
Native available + operation unverified → Native + reason
Native unavailable → HTTP Request + reason
Native exists + operation verified unsupported → HTTP Request + reason
Explicit user override → HTTP / Code allowed
```

Code is reserved for data transformation, calculations, custom logic, parsing, branching support. Code must never substitute for an available native node or a fitting HTTP Request.

### Existing components (do not duplicate)

- `N8nNodeInventory` — owns node inventory + schemas. Existing cache ~30s.
- `IntegrationRegistry` — owns credential/integration → provider mapping. Existing cache ~60s.

Do not create another node cache or a second source of truth.

---

## 1. Spike — Connected n8n Node Discovery (0.5d, no code)

Objective: determine whether Jaafar can obtain available node types using only the credentials it actually has (n8n API key). Do not assume browser session auth.

Test in order against a real connected instance:

1. `GET {baseUrl}/api/v1/node-types` with `X-N8N-API-KEY`. Record status, shape, versions, params, pagination, version behavior.
2. `GET {baseUrl}/rest/node-types`, `/rest/nodestypes`, `/rest/nodes` — using **API-key auth only**. These commonly require session auth; do not build production on a session Jaafar lacks.
3. Browser Network inspection of the n8n editor node picker — discovery only. Record endpoint, method, auth, shape, and whether the API key can reproduce it.

### Pre-approved fallback (no open-ended investigation)

- If an API-key-usable list exists → use it via the existing `N8nNodeInventory` infrastructure.
- Else → immediately use the minimal-alias approach: `IntegrationRegistry` + minimal native-node aliases + static validation.

Do NOT scrape the editor, depend on browser sessions, build a 400-node catalog, modify n8n, or inspect its filesystem/packages.

---

## 2. Instance Inventory (reuse, no new service)

Reuse `N8nNodeInventory`. It may contain `type, typeVersion, sampleParams, credentials`. It does NOT reliably contain operation-level metadata for every node, so operation support must be treated as verified / unverified (see §3), never assumed.

---

## 3. Operation Capability Model

Curated operation schemas exist only for a subset (e.g. Slack, Gmail, Sheets, Telegram). Define:

```ts
operations?: string[];
operationVerified: boolean;
```

- `operationVerified = true` → operation explicitly known from a trusted/curated schema.
- `operationVerified = false` → unknown whether the node supports it. It does NOT mean unsupported.

### Native selection rule

```text
Native available + operation verified supported → Native
Native available + operation unverified → Native + reason
Native available + operation verified unsupported → HTTP + reason
Native unavailable → HTTP + reason
```

This prevents blocking CRM/WhatsApp builds over incomplete operation docs.

---

## 4. Node Resolver (new, pure decision layer)

Add `src/modules/runtime/services/node-resolver.service.ts`.

Constraints: pure decision layer only. It must NOT call n8n, access the DB, maintain a cache/inventory, make LLM calls, or create another source of truth. It reuses `IntegrationRegistry` + `N8nNodeInventory` data passed in:

```ts
resolveNode({ integration, operation, instance, capabilities, override })
```

Returns e.g. `{ nodeType: "n8n-nodes-base.whatsApp", operation: "sendMessage", operationVerified: false, reason: "Native WhatsApp node is available in the connected n8n instance." }`.

Resolution priority: connected native → native + supported operation → alias fallback → HTTP → Code, with #4/#5 only when justified.

---

## 5. Integration Registry Fix

File: `src/modules/runtime/services/integration-registry.service.ts`.

- Keep `CREDENTIAL_TYPE_ALIASES` as the single provider-normalization source. Add missing aliases only when confirmed (e.g. `whatsApp*`, `hubSpot*`, `salesforceOAuth2Api`, `zoho*`, `pipedriveApi`).
- Replace loose `type.includes(provider)` with: exact alias lookup → normalized provider/node-suffix match → explicit mapping.
- Add `suggestedNodeType?: string` (e.g. `hubspot → n8n-nodes-base.hubSpot`) as fallback hints only — not proof of existence. No DB change.

---

## 6. Relevant Node Filtering (≤20, not 60–80)

Do not dump the full inventory into the planner prompt. Filter using existing understanding fields:

```text
User Request → Request Understanding (entities + actions + conditions)
  → detect providers → connected capabilities + N8nNodeInventory
  → relevant native nodes + structural nodes → planner
  → blueprint.integrations (output only, never an input to filtering)
```

- Do NOT reference `understanding.integrations` — it does not exist in `jaafar-understanding.schema.ts` and must not be added for this task.
- Include: natives matching detected providers, nodes matching connected capabilities, entity-implied nodes, structural nodes (`webhook, scheduleTrigger, manualTrigger, respondToWebhook, code, set, httpRequest, if`).
- Soft cap ~20; never drop a directly connected/relevant native node for the cap.

---

## 7. Planner Prompt Policy

File: `src/modules/runtime/services/jaafar-automation-graph.service.ts`, method `planSystemPrompt()`.

Add `<node_selection_policy>`:

```text
Jaafar builds against the user's connected n8n instance, the source of truth.
1. Native node: if compatible native exists, prefer it. Verified-supported → MUST use it. Unverified → still prefer + record nodeChoiceReason.
2. HTTP Request: no compatible native, or native verified unsupported, or user explicitly requests HTTP/API.
3. Code/Set/IF: transform, logic, parsing, branching only. Never as integration substitute.
Do not assume a native exists because n8n generally supports the provider.
Every integration step MUST include steps[].nodeHint = { type, typeVersion?, parameters }.
Generic choices MUST include nodeChoiceReason.
```

Sort the node list so connected-provider nodes come first, structural plumbing last. If `instance == null`, use fallback text "prefer native nodes for known providers, verify at static validation".

---

## 8. User Override Detection (`genericNodeOverride`)

Do not use raw substring checks like `message.includes("api")`.

Add to `src/modules/runtime/schemas/jaafar-understanding.schema.ts` (optional/default pattern like `clarificationQuestion`):

```ts
genericNodeOverride?: { requested: boolean; type?: "httpRequest" | "code"; }
```

Mirror it in `types/jaafar-understanding.types.ts` (hand-maintained interface, not `z.infer`).

Prompt (`jaafar-request-understanding.service.ts`: `buildSystemPrompt()` / `buildUserPrompt()` — NOT `understanding-policy.ts`, which holds only pure helpers):

- Positive (→ `requested: true`): "Use HTTP Request for this." / "Call the API directly." / "Use a custom API." / "Use the Code node."
- Negative (→ `requested: false`): "Send this through the WhatsApp API." / "Use the Shopify API to update the order." / "Send via the Gmail API." — "API" here names the capability, not an HTTP implementation.

---

## 9. Node Choice Reason

Add `nodeChoiceReason?: string` to `nodeHintSchema` (`automation-blueprint.schema.ts:18-22`). Zod-only, no DB migration. Examples:

- Native: "Native WhatsApp node is available in the connected n8n instance."
- Unverified: "Native node available, operation not covered by current schema."
- HTTP fallback: "No compatible native node in the connected instance."
- Unsupported: "Native exists but operation verified unsupported."
- Override: "User explicitly requested direct HTTP/API usage."

---

## 10. Plan Review Guardrail

File: `src/modules/runtime/services/automation-plan-review.service.ts`. New code `NATIVE_NODE_AVAILABLE`.

- Proven (instance shows native) + generic node + no override → **ERROR**, trigger replan, e.g. "Step X uses HTTP Request but the connected instance provides n8n-nodes-base.whatsApp. Replace it unless explicitly requested."
- Instance unreadable (`instance == null`) → **WARNING** only ("Could not verify native availability. Prefer natives where appropriate."). No false-positive replan loop.

---

## 11. Replan Feedback

`review_plan` (`jaafar-automation-graph.service.ts`) builds `planFeedback` from errors only today — warnings are dropped. Wire relevant native-node warnings/errors into the feedback so the second attempt (`MAX_PLAN_ATTEMPTS=2`, unchanged) actually corrects the choice. Same for `static_validate` failures.

---

## 12. Workflow Builder Guardrail (backstop only)

File: `src/modules/runtime/services/automation-workflow-builder.service.ts`. Keep `missing nodeHint → warning` for logic steps.

Upgrade to error only when: `step.integration` + proven native + generic node + no override — and the message must name the expected native node.

Dedup (intra-call, not graph state): `validateOnly()` runs `review.review()` then `validateNodes()` in one call, so the duplicate fires in the same pass. `validateNodes()` must skip when the review result already holds `NATIVE_NODE_AVAILABLE` for that `stepId`:

```ts
const alreadyReported = reviewed.errors.some(
  (e) => e.code === "NATIVE_NODE_AVAILABLE" && e.stepId === step.id,
);
if (alreadyReported) return; // review owns it
```

No new persistence/cache/fields, no attempt-budget increase.

---

## 13. Credential Attachment Fix

File: `src/infrastructure/n8n/n8n-provisioner.service.ts` (`reuseCredentials()`).

Today it only finds creds from previously-used workflow nodes → first-use native node (cred exists, node never used) provisions unauthenticated. Fix: existing-workflow lookup first, then fallback to available credentials by `credentialType`; on ambiguity return a clear credential-resolution error instead of a silent unauthenticated node. No schema change unless the credential model blocks the lookup.

---

## 14. Approval Payload

`await_approval` interrupt (`jaafar-automation-graph.service.ts:713-729`) sends only `name/action/integration` today. Add per-step `nodeType + nodeChoiceReason` so the user sees native vs HTTP before approving. SSE shape otherwise unchanged.

---

## 15. Provisioner (verify only)

`stepNode()` already honors `hint.type`; preserve `typeVersion`/params, attach creds per §13, fail clearly on unknown types, never silently downgrade native → HTTP (error → existing replan/recovery).

---

## 16. Tests

- Resolver: native verified → native; native unverified → native + reason; verified-unsupported → HTTP + reason; unavailable → HTTP; explicit HTTP/Code override; pure transform → Code; unknown integration → HTTP allowed.
- Review: whatsapp+HTTP+native → error; +override → valid; custom API+HTTP → valid; hubspot+Code+native → error; pure Code → valid; `instance==null`+HTTP → warning only, no hard error.
- Builder: backstop error on proven-native + generic; no duplicate when review already flagged same `stepId`; unknown + HTTP valid; logic + Code valid.
- Replan loop: HTTP → `NATIVE_NODE_AVAILABLE` → feedback present in 2nd prompt → native → PASS.
- Understanding: explicit HTTP/Code → override true; "…through the WhatsApp API" → false.
- Credentials: first-use attach by `credentialType`; ambiguity → clear error.
- Approval: payload contains `nodeType + nodeChoiceReason` per integration step.
- Suite: unit + e2e + `tsc` + `biome` green.

---

## 17. Evaluation Dataset

`src/modules/runtime/eval/jaafar-eval-dataset.json` (`kind: "review-plan"`): add native (WhatsApp send/template, HubSpot create/update, Zoho update, Shopify op, Gmail send, Slack send), HTTP (custom API; verified-unsupported op), logic (transform, branch), overrides ("Use HTTP for WhatsApp", "Use Code…"), plus a replan case (generic → validator → native). Verify `nodeType + nodeChoiceReason`; `npm run eval` green.

---

## 18. Acceptance Criteria

- [ ] Connected instance is source of truth; no global catalog, filesystem, or session scraping in prod; existing caches reused per connection.
- [ ] Native preferred when available; unverified ops eligible with reason; HTTP only when justified; Code for logic only.
- [ ] "API" wording alone never triggers override; `genericNodeOverride` survives Zod parsing.
- [ ] No reference to nonexistent `understanding.integrations`; providers from entities/actions/conditions.
- [ ] Review owns `NATIVE_NODE_AVAILABLE`; builder backstop dedups intra-call; `MAX_PLAN_ATTEMPTS=2` unchanged; feedback reaches replanner.
- [ ] `blueprintRevision()` uses deep deterministic serialization (recursive key sort, arrays ordered); nested node choices included; documented in comment; no migration; approval-validity mechanism unchanged (`resume()` checks `metadata.automationV2`).
- [ ] First-use creds resolve by `credentialType`; ambiguity errors clearly.
- [ ] Approval shows `nodeType + nodeChoiceReason` per integration step.
- [ ] Unit + e2e + tsc + biome + eval green.

---

## 19. Explicitly Out of Scope

Global 400+ catalog; full op docs per node; filesystem/package/source inspection; community-node auto-install; n8n modification; session scraping in prod; new cache layer / tables (unless cred lookup proves impossible); client/SSE changes; approval-validity redesign; `MAX_PLAN_ATTEMPTS` increase.

---

## 20. Implementation Order (~2–3d)

1. Spike (API-key only; fallback on failure) → 2. `nodeChoiceReason` + revision fix → 3. Pure NodeResolver → 4. Registry alias fix → 5. Relevant-node filtering → 6. Planner policy → 7. `genericNodeOverride` (schema + type + prompts) → 8. Review guardrail → 9. Builder backstop + dedup → 10. Replan feedback → 11. Credential fallback → 12. Approval payload → 13. Tests + evals → 14. Full validation suite.

## Core Principle

> Jaafar builds from what the user's connected n8n instance can actually provide — not what n8n supports in theory. Unverified does not mean unsupported. "The integration has an API" never means "the user wants HTTP Request."
