# Jaafar Harness / Runtime / Prompts — Bug Review

**Date:** 2026-09-11
**Scope:** `src/modules/runtime/` (harness, graphs, safety services), `src/config/schema.ts` (JAAFAR_* config), `src/infrastructure/prompts/` (Jaafar system prompts)
**Method:** Full-source review of harness, runtime orchestrator, LangGraph graphs, safety/state services, config validation, and prompt assembly. All findings verified against source (some against `@langchain/langgraph@1.4.9` internals in `node_modules`).

Legend: **P0** = critical (breakage / safety hole) · **P1** = high logic bug · **P2** = medium (duplicates, races, hygiene) · **P3** = low.

---

## P0 — Critical

### 1. Rejected blueprint can be provisioned without approval (approval-gate bypass)
- **Where:** `jaafar-automation-graph.service.ts:403-408` (reject path) vs `:597-612` (retry gate)
- **What happens:** The reject path sets `status=FAILED, phase=FAILED` and nothing else. But `review_plan` already persisted the full blueprint as the `automationPlan` artifact (`:849-853`), and `isRepairable()` (`agent-run.service.ts:209-214`) returns true for `FAILED`+`FAILED`. So `retryFromFailure()` hydrates the **rejected** blueprint, synthesizes `lastFailure` (`:641-645`), enters at `diagnose`; the classifier returns `UNKNOWN → escalate`, but `needsPatch()` (`automation-repair.service.ts:71`) returns true for `escalate` → LLM "patches" → revalidates → **provisions the design the user explicitly rejected, with no new approval**.
- **Fix:** Stamp `metadata.rejectedAt` (or `approvalDecision`) on the reject path and refuse retry when present; or gate retry-to-provision on the run having previously reached `EXECUTING`.

### 2. `JAAFAR_MAX_RUNTIME_MS` can never trip
- **Where:** `jaafar-execution-graph.service.ts:145, 217`; `jaafar-harness.service.ts:44`
- **What happens:** Both call sites pass `Date.now()` as `startedAt`, so `assertWithinLimits` computes `Date.now() - startedAt ≈ 0` every check. The wall-clock limit is unenforceable. Related: `HarnessUsage.elapsedMs` (`harness.interface.ts:23`) is never written anywhere — dead field that was presumably meant to carry this.
- **Fix:** Store run start time in graph state (set by the entry node) and pass it to every `assertWithinLimits` call; or maintain `usage.elapsedMs` and check it in the harness.

### 3. Execution-graph SSE never emits the approval gate → streams hang, run stuck
- **Where:** `jaafar-execution-graph.service.ts:380-421`
- **What happens:** LangGraph 1.4.9 emits an interrupt (in `updates` mode) as a **top-level** `{ __interrupt__: [...] }` chunk (verified in `dist/pregel/loop.js:406-409`), not nested under the interrupted node. The execution graph iterates `Object.entries(update)` and checks `node === 'invoke_tool' && state.__interrupt__` — never true (the interrupted node produces no update; the interrupt chunk has `node === '__interrupt__'`). So `approval.required` and `run.waiting` events (`:418-419`) are never yielded. `JaafarRuntimeService.stream` (`jaafar-runtime.service.ts:479-493`) never parks the row (stuck in `EXECUTING`), and the SSE ends with no terminal event — the client hangs.
- The automation graph handles this correctly (`jaafar-automation-graph.service.ts:1717`).
- **Fix:** Check `'__interrupt__' in update` before the `Object.entries` loop (mirror `mapStreamUpdate` in the automation graph), extract the interrupts array, and emit `approval.required` + `run.waiting`.

### 4. Successful blocking automation runs throw after completion → HTTP 500, billing/journal skipped
- **Where:** `jaafar-runtime.service.ts:183` (call), `:1012-1030` (`handleGraphCompletion`), `agent-run-phase.ts:67-78`, `jaafar-automation-graph.service.ts:1276-1285`
- **What happens:** The V2 `complete` node already advances the row to `COMPLETED/COMPLETED`. Then `start()` calls `handleGraphCompletion(...)` → `runs.complete()` → `validateTerminalWrite('COMPLETED','COMPLETED')` **throws** ("terminal cannot move to COMPLETED"). The exception propagates to `start()`'s catch (line 322), `runs.fail` also throws (swallowed), error rethrown (line 329) → controller returns **500 for a run whose workflow was actually built and provisioned**. The `run.completed` journal event and `recordBilling` never execute. (The streaming path swallows this in its try/catch at `:1149` — asymmetric.)
- **Fix:** In the automation branch, only mirror completion when the row is not already terminal; or make `handleGraphCompletion` tolerate already-terminal rows.

### 5. `resume()` never re-parks the row as WAITING on a second approval gate
- **Where:** `jaafar-runtime.service.ts:512-614`
- **What happens:** `resume()` pre-transitions WAITING→EXECUTING (line 519). If the resumed graph hits **another** approval interrupt (multi-step plans with multiple side-effecting tools), `resumeGraphBranch` returns `route: 'waiting'` — a `run.waiting` journal event is recorded (`:562-568`) but the row is **never transitioned back to WAITING** (compare `start()`, lines 271-272). On the next `approve()`, `isGraphExecution()` requires `run.status === 'WAITING'` (line 1234) → false → falls into the **legacy** runtime handler (lines 644-647), which cannot resume the execution-graph checkpoint. Run is unrecoverable through the API.
- **Fix:** In `resume()`, mirror `result.route === 'waiting'` with `runs.transitionStatus(runId, 'WAITING')` (guarded like the automation branch).

### 6. `JAAFAR_ALLOW_PARALLEL_READ_ONLY_TOOLS=false` parses to `true`
- **Where:** `src/config/schema.ts:71-75`
- **What happens:** With zod 3.24, `z.coerce.boolean()` is `Boolean(value)`; env values are strings, so `"false"` → `true`. `JaafarHarnessService.boolean()` (`jaafar-harness.service.ts:86-92`) carefully handles the string `"false"` — but it receives the *already-coerced* boolean from `validateConfig`, so that branch is dead and the safety flag cannot be disabled via env. (Kill-switch/enable flags happen to be read from raw `process.env` at `jaafar-runtime.service.ts:1077-1083`, so they are latent, not broken.)
- **Fix:** Replace `z.coerce.boolean()` with a preprocess accepting only `"true"/"1"` / `"false"/"0"` (also affects `SMTP_SECURE`, `OTEL_ENABLED`).

### 7. Context loader loads the OLDEST messages and does no tenant scoping
- **Where:** `jaafar-context-loader.service.ts:87-93`; `conversations.repository.ts:67-71, 21-28`
- **What happens:** `getMessages(conversationId, { take: 20 })` orders `createdAt: 'asc'` with no skip — for any conversation longer than 20 messages, understanding/planning see the **first 20 (oldest) messages** and silently drop everything recent; the manager's `.slice(-historyLimit)` (`jaafar-context-manager.service.ts:157-162`) tails the oldest window. Additionally `loadHistory` doesn't pass `userId`/`organizationId`, and `findById(id, undefined)` applies **no ownership filter** — a caller-supplied `conversationId` can read another tenant's messages.
- **Fix:** Query `orderBy: desc` + `take`, then reverse; pass `{ userId, organizationId }` scope into `getMessages`.

### 8. A `COMPLETED` idempotency record with a JSON-null result re-executes the side effect
- **Where:** `jaafar-idempotency.service.ts:73`; `tool-executor.service.ts:94`
- **What happens:** `toRecord` omits `result` when `record.result === null`; the executor only short-circuits when `status === 'COMPLETED' && result !== undefined`. A side-effect tool that legitimately returns `null` re-executes the external side effect on every subsequent call with the same key instead of replaying the cached result.
- **Fix:** Distinguish "no result stored" from "result is null" (sentinel, or check `record.status === 'COMPLETED'` alone).

### 9. Streaming entry point bypasses the startup quota check
- **Where:** `jaafar-runtime.service.ts:333-343` vs `61-65`
- **What happens:** `start()` runs `checkStartupQuota(request)` but `stream()` does not — `POST /runs/stream` creates runs and spends LLM credits with no quota enforcement.
- **Fix:** Run the same `rolloutFailure` + `checkStartupQuota` preamble in `stream()` and yield `eventFromFailure(...)` on denial.

---

## P1 — High logic bugs

### 10. Repair budget off-by-one: the MAX patch is computed then thrown away
- **Where:** `jaafar-automation-graph.service.ts:1553` (`attempts >= MAX_REPAIR_ATTEMPTS → escalate`); `automation-repair.service.ts:12`
- **What happens:** repair(1) → provision → fail → diagnose(2) → repair(2) → provision → fail → diagnose(**3**) → repair(3) → `3 >= 3` → escalate. The third `diagnoseAndPatch` LLM call and its revalidated patch (`:1189-1207, 1243-1251`) never reach `provision`. Effective budget is 2 while `MAX_REPAIR_ATTEMPTS = 3` and the reason string advertises 3.
- **Fix:** `attempts > MAX_REPAIR_ATTEMPTS`, or gate `diagnose` before patching on attempt 3.

### 11. Repair revalidation failure routes to `provision` with a known-invalid blueprint
- **Where:** `jaafar-automation-graph.service.ts:1252-1269`; route map `:1419-1424, 1551-1555`
- **What happens:** On revalidation failure the node returns `nextStep: 'provision'` — contradicting its own comment ("loop back into diagnosis while budget remains"). There is no `repair → diagnose` edge, so the graph goes to `provision` → `builder.build()` → `validateOnly()` throws the same static-validation error uncaught → whole run fails instead of looping through diagnose.
- **Fix:** Add a `diagnose` route from `repair` (set `lastFailure` + jump to diagnose), or treat revalidation failure as an escalation.

### 12. `maxEstimatedCost` / `maxOutputTokens` limits are dead code
- **Where:** `jaafar-execution-graph.service.ts` (usage channel only ever updated with `graphSteps:143`, `toolCalls:215`, `retriesByTool:276,282`); `jaafar-harness.service.ts:45-46`; `config/schema.ts:69-70`
- **What happens:** `usage.estimatedCost` / `usage.outputTokens` are never set from the `modelCalls` that do carry `usage.tokens` / `estimatedCost`, so `assertOptionalLimit` can never fire. `JAAFAR_MAX_ESTIMATED_COST` and `JAAFAR_MAX_OUTPUT_TOKENS` are configurable no-ops.
- **Fix:** Fold `generated.modelCall.usage` / `estimatedCost` into the usage channel in `final_response`, or assert against cumulative `modelCalls` before each LLM/tool call.

### 13. Graph-step off-by-one: a plan with exactly `maxGraphSteps` steps fails after completing all steps
- **Where:** `jaafar-execution-graph.service.ts:143-147`
- **What happens:** `select_action` increments `graphSteps` and asserts limits **before** checking whether a step exists. With `maxGraphSteps = 30` and a 30-step plan, the 31st `select_action` (terminal "no more steps" lookup) throws `HarnessLimitError` → route `'failed'` → run FAILED despite all steps succeeding.
- **Fix:** Check `state.input.plan.steps[state.stepIndex]` for existence first; only increment/assert when a step will actually be selected.

### 14. Classifier strategies (`escalate`, `fix_credentials`) are never honored by the graph
- **Where:** `automation-repair.service.ts:70-72`; `automation-error-classifier.service.ts:57-86, 163-168`
- **What happens:** `needsPatch()` returns true for every strategy except `retry_execution`. `PERMISSION_ERROR` (strategy `escalate`, has `userAction`) and `UNKNOWN` are routed into an LLM blueprint patch that cannot help, burning the full repair budget before escalating. The classifier's contract is not implemented.
- **Fix:** `needsPatch()` → false for `escalate`; short-circuit `fix_credentials` to an escalation message instead of patching.

### 15. `test_execute` collapses "no connection" and "no webhookPath" into a false credential error
- **Where:** `jaafar-automation-graph.service.ts:1111-1120`
- **What happens:** `if (!connection || !webhookPath)` returns `CREDENTIAL_ERROR` ("reconnect the client instance first") even when the connection is fine and only the webhook path is missing. The classifier matches it → `retryable:false`, strategy `fix_credentials` → futile LLM patch × 3 before escalating on a problem a blueprint patch cannot fix.
- **Fix:** Separate the conditions; missing webhook path → `INVALID_CONFIGURATION`/`LOGIC_ERROR`; credential-shaped user-action errors should short-circuit to escalation.

---

## P2 — Medium

### 16. Duplicate assistant message on the streaming automation path
- `complete` node writes the final response (`jaafar-automation-graph.service.ts:1309-1314`) and `stream()` writes it **again** on `run.completed` (`:321-327`). Every streamed successful run has the completion message twice in history.
- **Fix:** Remove one of the two writes.

### 17. Non-stream `run()` never persists the user message; stream never persists the approval summary
- `run()` (`:265-299`) skips `conversations.addMessage` for `input.userMessage` while `stream()` does (`:305-313`); conversely the approval summary is persisted in `run()` (`:280-285`) but in `stream()` only emitted as a transient token event (`:1884`). Conversation history diverges depending on the endpoint.

### 18. Blocking `start()` clarification branch does not persist the conversation turn (stream does)
- `jaafar-runtime.service.ts:125-142` vs `391-397`. `stream()` calls `persistClarificationTurn`; `start()` only writes `clarificationQuestion` to run metadata — the following turn's context has no record of the exchange.

### 19. Channel inbound messages are persisted twice (turns duplicated by graphs)
- `channels-inbound.service.ts:62-73, 90-99` records user + assistant messages, then every graph also persists its own turns (conversation `:306-319`, execution `:299-313`, automation `:307-313, 1310-1314, 281-285`). Channel conversations get duplicate messages on all routes.
- **Fix:** Single-owner persistence (channels rely on graphs, or graphs skip persistence via a `persistHistory: false` flag).

### 20. Concurrent `approve()` can execute a side-effect tool twice
- `jaafar-runtime.service.ts:616-657`; `runs.service.ts:92-108` (read-validate-write with no version guard). Two concurrent `POST /runs/:id/approve` calls both observe WAITING and both invoke `executionGraph.resume` on the same thread — the (possibly side-effecting) tool executes twice.
- **Fix:** Revalidate `run.status === 'WAITING'` in `approve()`; make the WAITING→EXECUTING claim atomic (compare-and-set) before resuming.

### 21. `approve()` has no status revalidation; `resume()` pre-transition outside its try block
- `jaafar-runtime.service.ts:516-521, 616-657`. `transitionStatus(runId,'EXECUTING')` (line 519) runs **before** `try` (line 521) — any invalid transition (CREATED→EXECUTING, duplicate approve) escapes uncaught → 500, no `run.failed` event. Approving a CREATED/PLANNING run or an already-COMPLETED run reaches `resume()`/`automationGraph.resume` unchecked.

### 22. Anti-re-ask filter contradicts the planner prompt that feeds it
- `jaafar-automation-graph.service.ts:1504-1521` vs `:1735`. The plan prompt instructs human-readable `missingRequirements` ("never a bare internal id like 'R1'"), but `unansweredMissingRequirements()` only recognizes `^(R\d+)$` — every prompt-compliant entry is treated as unanswered and re-asked forever; `describeMissingRequirement` is dead for compliant models.
- **Fix:** Align the two (emit R-ids, or parse the human-readable format).

### 23. Approval argument-risk check is trivially bypassable
- `jaafar-approval.service.ts:86-96`. Key test anchored `^(delete|destroy|...)$`, top level only: `{ deleteAll: true }`, `{ sendTo: "victim" }`, `{ options: { delete: true } }` all pass.
- **Fix:** Substring-match key names and recurse into nested objects.

### 24. Every retry of a side-effect tool re-prompts for approval
- `jaafar-execution-graph.service.ts:187-214`. The `interrupt()` check is unconditional on re-entry; the retry conditional edge (line 329) routes back into `invoke_tool`, so a retryable failure of an already-approved tool pauses the graph again.
- **Fix:** Record approved callIds in state and skip the interrupt for them.

### 25. `retriesByTool` counts failures, not retries — inflates across steps
- `jaafar-execution-graph.service.ts:270-289`. Incremented for every failure (including non-retryable and harness-abort results for tools that never executed, lines 219-230). Same `toolId` in a later step inherits the polluted counter, shrinking its real retry budget; can throw `GRAPH_LIMIT_REACHED` before executing.
- **Fix:** Increment only when `result.error?.retryable` and a retry will actually be taken.

### 26. Missing idempotency on message entry points
- `channels-inbound.service.ts:43-117`: no dedupe on `dto.externalMessageId` (duplicate WhatsApp/Slack retries → duplicate runs + doubled LLM cost); `resolveOrCreateConversation` (lines 144-175) is find-then-create with no uniqueness guard. `POST /runs` (`runtime.controller.ts:38-45`) has no idempotency key.

### 27. SSE disconnect before first event leaks the run row; cancellation never aborts actual work
- `runtime.controller.ts:68-92`; `jaafar-runtime.service.ts:746-761, 333-349`. Disconnect grace timer armed only when `activeRunId` is set per-event, but the run row is created before the first yield and LLM classification precedes it → disconnect in that window leaves the run in PLANNING forever. `cancel()` only flips status; no `AbortSignal` reaches `llmRuntime.generateStream`, the graph, or tool execution — a "cancelled" run keeps streaming tokens and calling tools (`recordModelUsage` has no terminal guard, `runs.service.ts:183-195`).

### 28. Non-stream conversation path creates two COMPLETED run rows per message
- `jaafar-runtime.service.ts:96-119, 213-238` vs `448`. Blocking conversation delegation lets `conversationGraph.run()` create+complete its own run, then `handleGraphCompletion` also completes the outer run → extra COMPLETED row with zero tokens that also gets `recordBilling` (line 230), polluting metrics/billing. Stream path supersedes correctly (`:448`).

### 29. Post-execution output-validation failure marks a completed side effect as FAILED → duplicate execution on retry
- `tool-executor.service.ts:103-113`. `validateOutput` runs **after** dispatch (side effect already happened); a validation throw marks the record FAILED (`isUnknownSideEffect` false) → graph retry re-executes the workflow. Only n8n *timeout* gets `markUnknown`.
- **Fix:** Treat any post-dispatch validation failure as UNKNOWN, or store COMPLETED with a validation-error flag.

### 30. `retriesByTool` increments also cause `state schema` / checkpoint failures for real tools
- `jaafar-state.schema.ts:45`: `executionMode` enum missing `'domain'` — used by registered tools (`tool-registry.service.ts:96-97`: `employee_get`, `employee_skills_list`, `integration_status`). Any state whose `context.skills` contains a domain tool fails `serializeJaafarState`, surfaced as `CHECKPOINT_INCOMPATIBLE` ("unsupported version") — the checkpointer (`langgraph-postgres-checkpointer.service.ts:107-114`) blanket-catches all parse errors, not just version mismatch.

### 31. Runtime-validation idempotency key never varies across versions
- `automation-runtime-validator.service.ts:64`: `validation:{runId}:{automationVersion ?? 1}` — the only caller (`test_execute`, `:1122-1129`) never passes `automationVersion`, so a repaired workflow can be "validated" against a cached pre-repair response (header forwarded verbatim in `n8n-workflow-executor.service.ts:87`).
- **Fix:** Pass `built.automation.version` from `provision`.

### 32. Deferred re-provisioning loses `genericNodeOverride`
- `jaafar-automation-graph.service.ts:509-535`. `provisionDeferred` hydrates blueprint/requirements/conditions but not the understanding's `genericNodeOverride`; if the plan was only valid because the user requested an HTTP/Code node, the deferred build fails (`automation-workflow-builder.service.ts:308, 387-417`).
- **Fix:** Persist the override in run metadata/artifacts and pass it into the deferred input.

### 33. Approval-gate WAITING status applied after `yield` in stream path
- `jaafar-automation-graph.service.ts:340-346`. WAITING advance for the approval interrupt runs only if the consumer pulls the generator again after `run.waiting` — an SSE client that disconnects on the wait event leaves the row non-WAITING and `resume()` then refuses approval.
- **Fix:** Advance to WAITING inside `await_approval` (before `interrupt()`).

### 34. Clarification can address a non-required input instead of the safety confirmation
- `understanding-policy.ts:65-70`. Fallback chain `clarificationQuestion ?? missingInputs[0]?.question ?? confirmation prompt` — `missingInputs[0]` is not filtered by `required` and takes precedence over `confirmationsNeeded` even when clarification was triggered by a high-risk assumption.
- **Fix:** Prefer `missingInputs.find(m => m.required)?.question`; fall back to `missingInputs[0]` only when no confirmation is pending.

### 35. Understanding schema defaults `confidence` to 1 (bypasses self-correction pass)
- `jaafar-understanding.schema.ts:55`. A model omitting `confidence` defaults to fully-confident, skipping the `< 0.6` re-check (`jaafar-request-understanding.service.ts:52`). Also `missingInputs` is the only array without `.default([])` — asymmetric strictness causing undeserved parse failures.

### 36. Budget trimming can still exceed `TOTAL_BUDGET_CHARS`
- `jaafar-context-manager.service.ts:327-352`. `over -= cut` ignores the ~13-char truncation marker; reported `totalChars` can exceed the 12k budget.

### 37. Quality metrics: no lower bound on `limit`; token averages skewed
- `jaafar-quality-metrics.service.ts:61, 140-143`. `limit=0`/negative yields empty metrics or a Prisma throw; averages divide by all rows, counting runs without token data as 0.

### 38. Duplicate model-supplied requirement ids pass through
- `understanding-policy.ts:17-18`. Requirements already carrying an `id` are returned unchanged even when duplicated → R-id collisions break the plan coverage map.

---

## P3 — Low

| # | Issue | Where |
|---|---|---|
| 39 | `HarnessUsage` cast to `RuntimeUsage` — type confusion; token fields `undefined` for execution runs | `jaafar-runtime.service.ts:180, 537` |
| 40 | Streaming execution path never persists token usage; `run.completed` carries wrong-shaped usage (`HarnessUsage` journaled as `RuntimeUsage`) | `jaafar-runtime.service.ts:886-899, 1133-1152`; `jaafar-execution-graph.service.ts:422-429` |
| 41 | Non-canonical idempotency hashing — `JSON.stringify(input)` is key-order dependent → spurious "reused with different input" | `jaafar-idempotency.service.ts:61-63` |
| 42 | Default `logicalAction` collides for direct executor calls (all calls to one tool share one idempotency key) | `tool-executor.service.ts:67, 89` |
| 43 | `JaafarMemoryPolicyService` wired but never used (secret scrubbing dead); `NaN < 0.8` is false so NaN confidence passes | `tool-executor.service.ts:63`; `jaafar-memory-policy.service.ts:15-20` |
| 44 | `markUnknown` doesn't set `completedAt`; `complete()` on a FAILED record leaves stale `error` | `idempotency.repository.ts:38-42` |
| 45 | Dead/unreachable `retryFrom` phase mappings (EXECUTING/RUNTIME_VALIDATION → provision/test_execute unreachable via `isRepairable`) | `jaafar-automation-graph.service.ts:607-612` |
| 46 | `formatApprovalSummary` always reports "Integrations: None specified" in stream path (interrupt payload omits integrations) | `jaafar-automation-graph.service.ts:947-972, 2011` |
| 47 | Dead input field `repairAttempt` — no caller sets it; fallbacks are dead code | `jaafar-automation-graph.service.ts:64, 1198, 1210, 1286, 1552` |
| 48 | Clarification volume vs identity prompt — graph can list up to 15 questions; identity prompt says max two | `jaafar-automation-graph.service.ts:867-875`; `jaafar.prompt.ts:32` |
| 49 | Fire-and-forget conversation write in `deferred` node (`void … .catch()`) — response can complete before persist | `jaafar-automation-graph.service.ts:1057-1061` |
| 50 | Anonymous-run scope holes — resume/retry/provisionDeferred skip validation when run row has no `userId`/`organizationId` | `jaafar-automation-graph.service.ts:373-382, 457-466, 576-585` |
| 51 | `retryAutomation` journals `run.completed` for WAITING results; row never re-parked | `jaafar-runtime.service.ts:698-718` |
| 52 | `cancel()`/reject TOCTOU on already-terminal rows → 500 instead of graceful result | `jaafar-runtime.service.ts:627-629, 746-749`; `runs.service.ts:148-150` |
| 53 | `mapExecutionStreamEvent` drops `args` from `tool.started`; `rolloutFailure` yields `run.failed` with `runId: ''`; `run.cancelled` unreachable in stream event switches | `jaafar-runtime.service.ts:853-859, 334-338, 1248-1261` |
| 54 | `POST /runs` returns `202 ACCEPTED` but blocks synchronously until the run finishes | `runtime.controller.ts:38-45` |
| 55 | Legacy `RunsService` transitions non-atomic (read-validate-write, no version guard) | `runs.service.ts:92-164` |
| 56 | Stream telemetry `durationMs` wrong for multi-node update batches (timestamp reset per batch, not per node) | `jaafar-execution-graph.service.ts:378-435` |
| 57 | Config bounds: `0` allowed for all JAAFAR_* limits (instant GRAPH_LIMIT_REACHED indistinguishable from misconfig); no upper caps | `config/schema.ts:65-68` |
| 58 | Schema versions (`z.literal(1)`) have no migration path; checkpointer converts any parse error into "unsupported version" | `jaafar-plan.schema.ts:34`; `jaafar-state.schema.ts:132`; `langgraph-postgres-checkpointer.service.ts:107-114` |
| 59 | Classifier nits: `RATE_LIMIT` regex matches any message containing "429"; `unknown node` alternative unreachable (claimed by `MISSING_DATA` first); coverageMap `S${index+1}` fallback indexes the filtered subset | `automation-error-classifier.service.ts:88, 109-119`; `automation-plan-review.service.ts:339` |
| 60 | Same-step expression reference reported as "runs later in the chain" | `automation-workflow-builder.service.ts:510-516` |

---

## Prompt issues

### P61. Dead prompt export contradicting enforced behavior
- `AUTOMATION_BLUEPRINT_SYSTEM_PROMPT` (`jaafar.prompt.ts:25-42`) has **zero call sites** (only re-exported in `system-prompts.ts:9`). It contradicts the enforced credential-independence rule (line 34 "only propose integrations the user has actually connected" vs `jaafar-automation-graph.service.ts:1738` which keeps unconnected known providers and builds anyway) and references a `client_n8n_instance_capabilities` tag never rendered anywhere (the plan prompt uses `<client_n8n_node_types>`). Would mislead if ever wired in.

### P62. Identity prompt vs graph behavior contradiction
- `JAAFAR_IDENTITY_SYSTEM_PROMPT` says "Ask no more than two clarification questions in one response" (`jaafar.prompt.ts:32`), while the graph can list up to 15 missing-requirement questions (`jaafar-automation-graph.service.ts:867-875`, schema cap 15).

### P63. Harness limit-name misuse on parallelism violation
- `assertParallelTools` (`jaafar-harness.service.ts:49-53`) throws `HarnessLimitError('maxToolCalls', count, count)` — mislabeled limit (parallelism violation reported as maxToolCalls, observed == limit), confusing for debugging.

### P64. `HarnessUsage.elapsedMs` is dead
- Declared in `harness.interface.ts:23`, initialized to 0 (`jaafar-execution-graph.service.ts:103`), never written or read — replaced by the broken `startedAt` mechanism (see #2).

---

## Verified non-issues (checked, not bugs)

- Approval bypass via run-level `approvalStatus`: runtime never populates it when building `executionInput`; tools with `requiresApproval || sideEffect` always interrupt.
- n8n side-effect coverage: automation tools built with `sideEffect: true`; n8n timeout → `markUnknown` → retry correctly aborts with `UNKNOWN_RUNTIME_FAILURE`.
- Dependency-cycle detection/ordering in `jaafar-planning.service.ts:121-141, 221-237` is correct.
- `assignStepIds` runs before the duplicate-id check (no false positive); replan loops are bounded.
- LangGraph state is fully serializable; usage reducer accumulates correctly.
- Deferred flow re-entry guards and re-deferral idempotency are consistent.
- Status/phase state machine (`agent-run-phase.ts`) correctly blocks COMPLETED/FAILED from non-matching phases.
- `successRate` denominator matches its documented intent.

---

## Suggested fix phases

1. **Phase 1 (P0):** #1, #2, #3, #4, #5, #6, #7, #8, #9 — safety gates, hung streams, false 500s, dead limits.
2. **Phase 2 (P1):** #10, #11, #12, #13, #14, #15 — repair loop, classifier honoring, cost accounting.
3. **Phase 3 (P2):** persistence ownership, approve() revalidation + atomic claim, risk-check hardening, retry accounting, schema fixes, webhook idempotency.
4. **Phase 4 (prompts/P3):** delete or rewrite the dead blueprint prompt, reconcile question-count + re-ask filter, cleanup items.

Each phase should extend the existing specs (`src/modules/runtime/**/*.spec.ts`, 411-test baseline) and run `vitest`.