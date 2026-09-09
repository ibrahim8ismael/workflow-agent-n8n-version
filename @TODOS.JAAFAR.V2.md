# Jaafar V2 — Reliability Fixes + Rebuild Todos

> Aligned with `docs/Jaafar-improve.md` (V2 vision). V2 replaces the automation-design flow.
> Keep `@RULE.AGENT.Jaafar.md` tone rules everywhere (bilingual, approval before creation,
> "Automation" vocabulary — no "bot/workflow/nodes" wording).

---

# Phase 0 — Immediate Reliability Fixes ✅ DONE

_Pure bug fixes; survive the V2 rebuild. No schema changes._

## 0.1 Failures visible to the user
- [x] Render every `run.failed` / harness-limit / approval-needed SSE event as a rendered
  `token` event, mapped via `runtimeUserErrorMessage`
  (`jaafar-runtime.service.ts:396-398, 508-515`; conversation graph `:206-215`)
  → implemented centrally in `runtime.controller.ts`: every `run.failed` now emits a
  human `token` before the failure event, so the client never freezes silently.
- [x] Never persist raw internal error strings as assistant messages
  (`jaafar-conversation-graph.service.run()` stores `LLM execution timed out...` today)
  → `run()` failure path now returns the mapped user message.
- [x] Characterization tests: failure stream → user sees message + run row FAILED
  → covered by updated runtime/conversation specs; 615/615 green.

## 0.2 Streaming robustness
- [x] Split timeouts in `llm-runtime.service.ts`: first-byte (~45s) vs inter-chunk (~20s)
- [x] Add retry/failover for streams (currently only `resolveCandidates(mode)[0]` and catch rethrows)
  → candidate failover while no token has been emitted yet.
- [ ] Real `AbortController` on stream timeout (no lingering OpenRouter calls)
  → DEFERRED: the adapter layer (`ai-adapter.interface.ts`) has no abort-signal slot;
  requires an adapter-contract change across providers — revisit in Phase 5 hardening.
- [x] SSE disconnect → 10s grace period before `cancel()` (`runtime.controller.ts:66-73`)
- [x] Persist the user message BEFORE streaming starts (currently lost on mid-stream failure,
  `jaafar-conversation-graph.service.ts:193-203`)

## 0.3 Empty-response guard
- [x] Guard empty output from think-tag filter (stream dead inside reasoning block,
  `think-tags.ts:92-108`): one retry ignoring think filter, then raw fallback
  → one non-stream retry; raw content fallback when stripping clears everything.

## 0.4 Understanding quality (fewer needless clarifications)
- [x] Replace forced clarification at `confidence < 0.6` with: one retry at higher effort,
  then answer as conversation instead of asking (`jaafar-request-understanding.service.ts:42-48`)
  → one self-correction pass at `high` effort; proceeds with best intent either way.
  Prompt updated: ask ONLY when a required input is missing with no reasonable default.
- [x] Map Zod/understanding failures into retry path; add `understanding_failed` metadata
  instead of silent conversation degrade (`jaafar-runtime.service.ts:362-374`)
  → PARTIAL: classifier failure still degrades to conversation, but the run is now
  parked as `superseded` and any downstream failure surfaces a user-visible message (0.1).
  Full `understanding_failed` metadata tagging moves to the Phase 3 V2 graph.
- [x] TTL (24h) on `findLatestWaitingInConversation` — stale clarifications stop
  polluting new turns (`runs.service.ts:48-58`)
- [x] Remove double classify+plan for task runs (`jaafar-graph.service.ts:293-320`
  re-runs the whole understanding graph = 4 sequential LLM calls)
  → `plan_task` now calls `JaafarPlanningService` directly on the first understanding.

## 0.5 Model config
- [x] Point `LLM_MEDIUM` at a stronger model (minimax-m3 too weak); keep minimax as `LLM_LOW`
  → `.env`: `LLM_MEDIUM_MODEL=openrouter:openai/gpt-5.6-luna`,
  `LLM_MEDIUM_FALLBACKS=openrouter:minimax/minimax-m3`.

### Done when
- [x] Any failure the user hits shows a friendly message (never a silent stop)
- [x] Clarification only when the case is truly blocking
- [x] 555+ tests green, typecheck + lint clean → **615/615 green, `tsc` + `biome ci` clean**

---

# Phase 1 — AgentRun + State Machine (Milestone 1, foundation) ✅ DONE

- [x] Extend Prisma `Run` with AgentRun fields: `currentPhase`, `businessContext`,
  `requirements`, `assumptions`, `constraints`, `automationPlan`, `workflowId`,
  `workflowVersion`, `validationResult`, `executionResults`, `repairAttempts[]`,
  `metrics` (+ indexes)
  → migration `20260909103414_add_agent_run_lifecycle` (+ `AgentRunPhase` enum,
  `agent_run_transitions` table). NOTE: applying it locally required backfilling one
  seeded Jaafar row whose `agents.model` was NULL — pre-existing drift (old migration
  inserted NULL, schema already requires the column). Same one-row backfill will be
  needed on staging/prod deploy.
- [x] New phase enum + mapping: `UNDERSTANDING → PLANNING → BUILDING →
  STATIC_VALIDATION → EXECUTING → RUNTIME_VALIDATION → COMPLETED`;
  failure path `FAILED → DIAGNOSING → REPAIRING → EXECUTING`
  → `src/modules/runs/agent-run-phase.ts` (single source of truth; legacy status map
  moved there too).
- [x] Enforce transition validation on terminal writes (`complete/fail/cancel`
  currently bypass `validateTransition`, `runs.service.ts:76-100`)
  → terminal sources can never move again (COMPLETED/FAILED/CANCELLED/TIMEOUT lock).
- [x] Store transition `reason` + timestamps for every state change
  → `agent_run_transitions` journal row on every status/phase write (+ `transitions()`
  reader; `complete/fail/cancel/transitionStatus` accept an optional `reason`).
- [x] `AgentRunService`: create / transition / persist / resume / cancel, optimistic
  version guard (reuse `Run.version` pattern from `claimAutomationCreation`)
  → `src/modules/runs/agent-run.service.ts`, exported from `RunsModule`. Extra guards
  beyond the plan: COMPLETED status requires COMPLETED phase (kills false "success"
  reports), statuses move forward-only, FAILED→EXECUTING repair-resume edge.
- [x] Durable resume via existing Postgres checkpointer
  (`langgraph-postgres-checkpointer.service.ts`)
  → PARTIAL: `snapshot()` returns run + full transition trail and `resume()` reopens
  WAITING runs; full graph-level resume against the Postgres checkpointer lands with
  the Phase 3 V2 graph, which will drive runs through this service.

### Done when
- [x] Run can resume from last valid state; a COMPLETED run cannot keep mutating;
  every transition persisted with reason.
  → verified by 41 runs-module specs + a real-DB lifecycle smoke run
  (create → … → COMPLETED, 7-row trail, stale-version conflict + terminal escape rejected).

---

# Phase 2 — Context Manager + Registries (doc §3–§6) ✅ DONE

## 2.1 Context Manager
- [x] Build on `jaafar-context-loader`: stage-specific context builds
  (business / integration / conversation / workflow / failure), size limits
  → `JaafarContextManagerService.buildForStage()` with stages UNDERSTANDING /
  PLANNING / BUILDING / EXECUTING / FAILURE; 12k-char total budget + per-section
  caps, truncation reported (`truncated[]`, oldest-first for conversation),
  `renderToPromptText()` for direct prompt use. Optional sections degrade to
  `unavailable` — context never breaks a run.
- [x] Load business profile, org info, connected integrations, preferences;
  drop irrelevant context per stage
  → PARTIAL: agent identity + caller-provided business profile/preferences are
  modeled now (`ProvidedBusinessProfile`/`ProvidedPreferences` with source honesty —
  no invented org data; `OrganizationsService` is an empty stub). Structured
  BusinessProfile store stays in Milestone 4; Phase 3 graph will pass what it knows.

## 2.2 Integration Registry
- [x] Map n8n credentials → integrations with `capabilities` + `credentialsAvailable`
  (extend `n8n-client-api.service.ts`); cache with refresh
  → `listCredentials()` (id/name/type only — n8n never returns secrets here) +
  `IntegrationRegistryService.capabilitiesForScope()` merging n8n credentials
  (joined with observed node types, winning conflicts) and platform Integration rows;
  60s per-scope cache + `invalidate()`.
- [x] Never expose secrets to the LLM — safe capability metadata only
  → only credential TYPE names + status metadata reach callers (spec asserts the
  serialized output contains no keys/ids).

## 2.3 Node registry + `get_node_schema`
- [x] Index nodes / operations / required+optional params / credentials in
  `n8n-node-inventory.service.ts`
  → harvest-based index (existing) + curated schemas for structural nodes
  (webhook/schedule/manual/respond/code/set/httpRequest/if) + operation lists for
  slack/gmail/googleSheets/telegram.
- [x] `get_node_schema(nodeType, operation)` returns required/optional/credentials;
  reject hallucinated node/operation with structured error
  → `describeNodeType()` with `N8nNodeSchemaError` (`NODE_NOT_FOUND` + available
  list; `OPERATION_NOT_SUPPORTED` on exhaustive trigger/plumbing nodes).
  Integration-node operations are non-exhaustive: unknown ops resolve with
  `operationVerified: false` instead of failing the build. Short names resolve
  (`slack` → `n8n-nodes-base.slack`).

### Done when (Phase 2)
- [x] 632/632 unit + 35/35 e2e green, `tsc` + `biome ci` clean.
- [x] New services wired in `RuntimeModule` (also exported `N8nClientApiService`
  from infra `N8nModule` — caught by e2e DI check).

---

# Phase 3 — Understanding → Plan → Build (REPLACES the automation-design flow, doc §10–§21) ✅ DONE

_RETIRED: `jaafar-automation-design-graph.service.ts` (+ inventory spec),
`automation-design-session.service.ts` (+ spec), `POST /runs/:id/confirm` (+ dto/spec),
dead `runtime-router.service.ts` (+ spec, was unregistered). Approval is unified on
`POST /runs/:id/approve|reject`. Wire value `automation_design` (RuntimeMode) KEPT —
renaming it would break clients; the flow behind it is V2._

## 3.1 Understanding v2
- [x] Extract goal / trigger / actions / entities / conditions / constraints (§10)
  → schema + prompt extended; stable requirement ids (R1, R2…) assigned in service.
- [x] Assumption Engine (§12): assume when obvious + reversible + safe default exists;
  ASK ONLY when money / data deletion / security / irreversible / missing credential
  → high-risk or irreversible assumptions get `needsConfirmation` and force a focused
  clarification naming them; everything else proceeds silently.
- [x] Requirements with stable IDs (R1, R2...) + required/optional flags (§11)

## 3.2 Plan schema + review
- [x] Stable plan IR (§14): trigger, steps with explicit conditions, provider+operation
  refs; extend `AutomationBlueprint` + `jaafarPlanSchema`
  → steps gained `id` (S1…, auto-assigned), `requirementIds`, `condition`,
  `expectedOutput`. (Task-execution `jaafarPlanSchema` untouched — blueprint IS the
  automation plan IR.)
- [x] Validate every plan before build (§15): trigger/actions/integrations/conditions/
  data flow/error handling/idempotency; extend `jaafar-planning.service.validatePlan()`
  → new `AutomationPlanReviewService`: goal/trigger/steps/dupes + unknown-integration
  (against registry capabilities) + side-effect-without-risk-notes warnings.
- [x] Requirement → step coverage map (§20); no build without a valid plan
  → `coverageMap()`; required-uncovered = hard error; builder throws before touching n8n.

## 3.3 V2 graph
- [x] New LangGraph: `understand → plan → validate_plan (fix loop) → build →
  static_validate → await_approval (interrupt, reuse jaafar-approval) → provision →
  execute_check`
  → `JaafarAutomationGraphService`: understand (reuses v2 understanding, skips when
  pre-computed) → plan (PLANNING context + capabilities + harvested node types) →
  review_plan (re-plan with feedback, max 2) → build → static_validate →
  await_approval interrupt → provision → verify (read-back). Every node advances
  `AgentRunService` phases; COMPLETED requires the full walk — success can no longer
  be reported before verification (kills the known false-completion pattern).
- [x] Stream phase-progress events: "Understanding ✓ / Planning ✓ / Building ⏳ ..." (§41)
  → token events per phase over the existing SSE channel (zero client changes).
- [x] Retire design graph files + `/runs/:id/confirm` + mode `automation_design` (name V2)
  → files + endpoint retired; pre-V2 WAITING runs get the graceful "restate your
  request" message on approve (cutover rule).

## 3.4 Workflow Builder (§16–§17)
- [x] Incremental build: trigger → core processing → business logic → integrations →
  notifications → error handling; save + validate after each stage
  → PARTIAL: static validation runs fully BEFORE any n8n write; the Automation row is
  persisted PENDING_APPROVAL before provisioning (failed provisions stay recoverable
  via reprovision). Provisioner-internal staging (tables → workflow → activate →
  read-back) reused as-is.
- [x] Workflow versioning on `Automation` (currently only blueprintRevision hash,
  `automation-blueprint.schema.ts:78-82`); rollback support
  → migration `add_automation_versioning`: `version` + append-only `blueprintHistory`;
  every provision bumps; `rollbackToVersion()` re-provisions history as a new version;
  run records `workflowId/workflowVersion`.
- [x] Build on `n8n-provisioner.service.ts` (reuse data-tables, dual trigger,
  credential reuse, HTTP/Code fallbacks)

## 3.5 Expression Safety + Static Validator (§18–§19)
- [x] Expression checks: referenced node/field exists, syntax, undefined-detectable,
  no references to future nodes
  → balanced `{{ }}` delimiters, `$('name')`/`$node["name"]` resolve against earlier
  chain steps (forward refs + dangling refs are errors), unknown `$roots` warn.
- [x] Static validation: trigger exists, no orphan/unreachable nodes, valid entry,
  required fields + credentials + valid ops, error paths exist
  → trigger-config check, per-step nodeHint pattern + harvested-inventory existence
  (hallucinated nodes are hard errors), schedule-config check. Chain linearity comes
  from the provisioner by construction; idempotency enforcement moves to Phase 4.
- [x] Block COMPLETED unless requirement coverage passes — kills the known
  "false completion claim" bug (`docs/jaafar-employee-creation-bug-report.md`)
  → enforced twice: builder throws on invalid plans, and `AgentRunService` rejects
  COMPLETED status outside the COMPLETED phase.
- [x] Delete replaced design files once parity reached
  → deleted; full vertical slice (connect → design → approve → provision → verify →
  execute) passes through V2 with mocked LLM/fetch.

### Done when (Phase 3)
- [x] 643/643 unit + 35/35 e2e green, `tsc` + `biome ci` clean.

---

# Phase 4 — Execution + Runtime Validation + Self-Repair (Milestone 2, doc §21–§27) ✅ DONE

- [x] Test-data execution via existing webhook/HMAC executor; capture execution ID,
  node outputs, errors, durations
  → `AutomationRuntimeValidatorService`: test input generated from the blueprint's
  `inputContract` (+ validation marker), executed via `N8nWorkflowExecutorService`
  with a `validation:{run}:{version}` idempotency key; duration + raw output captured.
- [x] Runtime validator (§22): expected nodes ran + expected side effects verified →
  only then COMPLETED. **No success before validation (hard rule §0.1)**
  → checks: `workflow_responded` + `no_error_flag` (success=false fails) +
  `output_contract` (every declared key present). Node-level evidence via the
  executions API is a documented gap (needs API scope the client key may not have).
  `complete` node advances COMPLETED only after verify + test pass.
- [x] Error classifier (§25): CREDENTIAL / PERMISSION / INVALID_CONFIG /
  INVALID_EXPRESSION / MISSING_DATA / API_ERROR / RATE_LIMIT / TIMEOUT / LOGIC / UNKNOWN
  → `AutomationErrorClassifierService` with `retryable` + first `repairStrategy`;
  credential/permission failures carry a concrete `userAction` (§26).
- [x] Self-repair engine (§23): failed node → root cause → repair plan → modify →
  revalidate → reexecute; persist attempts
  → V2 graph loop `test_execute → diagnose → repair → provision → verify → test…`:
  diagnose classifies + LLM root-cause (transient → unchanged retry, no model call
  wasted otherwise); repair revalidates via `validateOnly` then routes to `provision`
  (single provisioning owner — no double-provision); every attempt appended to the
  run's `repairAttempts` trail (`AgentRunService.appendRepairAttempt`).
- [x] `MAX_REPAIR_ATTEMPTS = 3` → escalate with doc §42 UX: what succeeded, what failed,
  exact blocker, required user action
  → `escalate` node advances FAILED + `escalationMessage()` (succeeded list derived
  from reached stages); stream emits `run.failed` so the client renders it.
- [x] Resume after user fixes credential (§43): continue from failed stage, no rebuild
  → `POST /runs/:id/retry` → `retryFromFailure()`: scope + V2 + `isRepairable` gates,
  then re-enters at `provision`/`test_execute`/`diagnose` by failed phase on a fresh
  checkpoint thread with state hydrated from run artifacts (blueprint, automation row,
  requirements, attempt trail) — fresh repair budget, growing audit trail.
- [x] Never expose credential secrets; clear missing-credential messages (§26)
  → validator/registry pass only baseUrl + webhookPath; classifier maps inactive
  connections to CREDENTIAL_ERROR with a reconnect action.

### Done when (Phase 4)
- [x] 668/668 unit + 37/37 e2e green, `tsc` + `biome ci` clean (incl. 2 new retry e2e tests).

---

# Phase 5 — Observability + Evaluation (Milestone 3+, doc §29–§36) ✅ DONE

- [x] Full trace per run: LLM calls, tool calls, state transitions, workflow changes,
  executions, errors, repairs; correlate Jaafar run ↔ n8n execution
  → `AgentRunTraceService.trace()` + `GET /runs/:id/trace`: usage/cost/duration,
  understanding artifacts, plan + coverage, validation + execution results, repair
  trail, transition history, journaled SSE events, and the n8n correlation
  (automation/externalWorkflowId/webhookPath/version). Assembled from existing
  stores — no new tables. Runs stamped `agentRunVersion: 'v2'` (§47-lite).
- [x] Extend `docs/jaafar-runtime-evaluation-dataset.json` toward 50 cases per doc §32
  → new code-owned `src/modules/runtime/eval/jaafar-eval-dataset.json`: 50 unique
  scenarios (basic 5, mapping 5, logic 5, integrations 5, failure 10, reliability 5,
  ambiguous 5, complex 10 — incl. 3 live-only). Legacy docs file left untouched.
- [x] Metrics (§33): success / validity / runtime / requirement coverage / tool-call
  accuracy / unnecessary-question rate / repair success
  → `JaafarQualityMetricsService` + `GET /runs/metrics/summary`: success/failure/
  waiting/clarification/validation-pass rates, repair attempted/repaired/success/avg,
  duration/token/cost averages + totals over a bounded window. Tool-call accuracy
  stays a manual review item (tool events are journaled per run for it).
- [x] Failure → eval pipeline (§35): production failure → root cause → regression test
  → `JaafarFailureEvalService.draftRegressionFromRun()`: failed trace → reviewable
  `classify-error` draft (stage + suspected code). Returned, never auto-appended.
- [x] Release gate (§48): no regression on eval suite before version bump
  → `npm run eval`: dataset schema validation + 47-case offline run against the real
  classifier/review/validator/policy components (3 live-only skipped). Zero failures
  required. Runs in CI as part of `npm test` too.

### Done when (Phase 5)
- [x] 680/680 unit + 39/39 e2e green, `tsc` + `biome ci` clean (incl. trace e2e;
  e2e mock DB gained the `agentRunTransition` model).

---

# Implementation Order (sized)

| Phase | Scope | Est. |
|---|---|---|
| 0 | Reliability fixes | 2–3 days | ✅ done |
| 1 | AgentRun + state machine | 2–3 days | ✅ done |
| 2 | Context + registries | 2 days | ✅ done |
| 3 | Understanding/plan/build + new graph (cutover) | 4–5 days | ✅ done |
| 4 | Runtime validation + self-repair | 3–4 days | ✅ done |
| 5 | Traces + evals | 2–3 days | ✅ done |

## Cutover rule (Phase 3)
Design flow is replaced once, as a unit: `/runs/:id/confirm` retired,
in-flight WAITING design runs get a graceful "please restate your request" message.

## Release gate per phase
Tests (unit + e2e) green, typecheck + biome clean, no regression on prior phases.
