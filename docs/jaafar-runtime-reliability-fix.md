# Jaafar Runtime Reliability Fix — Final Build Plan

## Objective

Fix the three runtime reliability issues discovered during the scheduled WhatsApp workflow test:

> "Every 10 minutes, send me a WhatsApp message saying Hello World."

The implementation must preserve the existing architecture, retry budget, phases, and LLM abstraction.

---

# P0-1 — Fix Replan State Transitions

## Root Cause

Current graph behavior:

```text
PLANNING
   ↓
BUILDING
   ↓
STATIC_VALIDATION
   ↓
FAIL
   ↓
PLANNING
```

The second transition fails because:

```text
BUILDING → PLANNING
```

is not an allowed transition.

The root cause is that `build` advances the phase to `BUILDING` before static validation has passed.

## Required Architecture

The desired flow is:

```text
PLANNING
   ↓
STATIC_VALIDATION
   ↓
PASS
   ↓
BUILDING
   ↓
EXECUTING
```

On validation failure:

```text
PLANNING
   ↓
STATIC_VALIDATION
   ↓
FAIL
   ↓
PLANNING
```

No `BUILDING → PLANNING` transition should be required.

---

## Implementation

### A. Make `build` a passthrough

In:

```text
src/modules/runtime/services/jaafar-automation-graph.service.ts
```

the build node currently advances the phase to `BUILDING` (`.addNode('build')`).

Remove that unconditional phase advance.

Keep the build node itself because the existing graph depends on it:

```text
review → build → static_validate
```

and because the build/static token mapping (`mapStreamUpdate`, `node === 'build' || node === 'static_validate'`) depends on this node.

The build node should become a passthrough in terms of phase management.

---

### B. Add `PLANNING → STATIC_VALIDATION`

Update:

```text
src/modules/runtime/services/agent-run-phase.ts
```

The phase map currently allows:

```text
PLANNING → BUILDING
```

but does not allow:

```text
PLANNING → STATIC_VALIDATION
```

Add:

```text
PLANNING → STATIC_VALIDATION
```

The existing:

```text
STATIC_VALIDATION → BUILDING
```

edge should remain.

---

### C. Add `BUILDING → EXECUTING`

The provision/build execution path advances:

```text
BUILDING → EXECUTING
```

but this transition is currently missing from the phase map.

Add:

```text
BUILDING → EXECUTING
```

Do not add a generic:

```text
BUILDING → PLANNING
```

transition. No status-map change is needed (`PLANNING → EXECUTING` status edge already exists).

---

### D. Static Validation Controls BUILDING

Static validation should be the point where the run enters `BUILDING`.

Successful path (static PASS advances `PLANNING → STATIC_VALIDATION`, then `→ BUILDING`):

```text
PLANNING
   ↓
STATIC_VALIDATION
   ↓
valid === true
   ↓
BUILDING
```

Failed path:

```text
PLANNING
   ↓
STATIC_VALIDATION
   ↓
valid === false
   ↓
replan
   ↓
PLANNING
```

Same-phase:

```text
PLANNING → PLANNING
```

is already treated as a no-op by `agent-run.service.ts`, so no new transition is required.

---

## Tests

Update the graph phase-walk expectation.

Current:

```text
[PLANNING, BUILDING, STATIC_VALIDATION]
```

must become:

```text
[PLANNING, STATIC_VALIDATION, BUILDING]
```

Add transition tests covering:

```text
PLANNING → STATIC_VALIDATION      allowed
STATIC_VALIDATION → BUILDING      allowed
BUILDING → EXECUTING              allowed
BUILDING → PLANNING               not required / remains invalid
PLANNING → PLANNING               no-op
```

Add a complete replan test:

```text
PLANNING
  ↓
STATIC_VALIDATION
  ↓
FAIL
  ↓
PLANNING
  ↓
STATIC_VALIDATION
  ↓
PASS
  ↓
BUILDING
```

The test must prove that the replan never requires:

```text
BUILDING → PLANNING
```

---

# P0-2 — Persist `validationResult`

## Root Cause

Static validation already produces useful diagnostics, but the crashed run showed:

```text
validationResult: null
```

The result must be recorded before the graph returns for replanning.

---

## Required Behavior

When static validation fails:

```text
static_validate
      ↓
validationResult
      ↓
recordArtifacts()
      ↓
planFeedback
      ↓
replan
```

Record the existing validation shape, matching the successful builder shape:

```ts
{
  valid: false,
  errors,
  warnings,
  coverage
}
```

Preserve any additional existing validation metadata where applicable.

---

## Important: MAX_ATTEMPTS Throw Branch

There are two failure paths:

### Normal replan

```text
validation fails
→ attempts remain
→ record validationResult
→ replan
```

### Attempt budget exhausted

```text
validation fails
→ MAX_PLAN_ATTEMPTS reached
→ record validationResult
→ throw/fail
```

The second path must also record `validationResult`.

Do NOT rely only on `failRun(reason)` because that currently preserves only the failure reason and leaves:

```text
validationResult = null
```

---

## Implementation

Reuse:

```text
AgentRunService.recordArtifacts()
```

which already accepts `validationResult`.

Do not introduce:

* a new DB table
* a new validation store
* a second validation-result format

The existing run metadata/artifact mechanism remains the source of truth.

---

## Tests

Add assertions for:

### Replan branch

```text
validation fails
→ validationResult recorded
→ replan
```

### Final failure branch

```text
validation fails
→ MAX_PLAN_ATTEMPTS reached
→ validationResult recorded
→ run FAILED
```

Verify both contain:

```text
valid
errors
warnings
coverage
```

and that the failed run no longer loses the validation diagnostics.

---

# P1 — Understanding Model Failure Diagnostics

## Important Finding

Do NOT implement another retry system.

The existing architecture already has retry/fallback behavior.

### Existing Adapter Recovery

`ai-adapter.service.ts` already handles:

```text
NoObjectGeneratedError
        ↓
generateText
        ↓
JSON repair/extraction
        ↓
safeParse
```

### Existing Runtime Retry

`llm-runtime.service.ts` already handles retryable failures:

```text
retry
   ↓
same candidate
   ↓
failover
   ↓
Minimax fallback
```

The observed run already survived multiple attempts across two models.

Therefore, more retries of the same type are not the solution.

---

# Actual P1 Problem

The system does not preserve enough information to determine why structured generation failed.

We need to answer:

```text
Was the output empty?
Was it malformed?
Was it valid JSON but schema-invalid?
Was it truncated?
What was finishReason?
What did the model actually return?
```

---

# P1.1 — Persist Failure Diagnostics

At the adapter boundary, when object generation ultimately fails, persist a **truncated raw-output sample** and the model's:

```text
finishReason
```

into existing run metadata/context (e.g. `failRun` reason / `updateMetadata` — no new store).

Do not store unlimited model output.

Use a safe bounded length consistent with existing metadata limits (precedent: 500-char reason slice).

The diagnostic should be enough to determine whether the failure was:

```text
empty output
truncated JSON
prose
fenced JSON
schema mismatch
```

---

# P1.2 — Classify the Adapter Failure

Classification should happen at the adapter boundary, where structured-generation errors are already handled.

Use the existing error conventions where possible.

Minimum categories:

```text
EMPTY
MALFORMED
SCHEMA_INVALID
```

Do not introduce a new global error taxonomy unless the existing architecture requires it.

The classification should answer:

```text
EMPTY
→ model returned no usable object

MALFORMED
→ output existed but could not be parsed/recovered as JSON

SCHEMA_INVALID
→ structured data existed but failed the expected schema
```

Preserve the underlying error as well.

---

# P1.3 — Check Truncation Before More Retry Logic

The understanding generation currently has a maximum-token configuration (`maxTokens: 1800` in the understanding call).

Investigate the existing:

```text
maxTokens
finishReason
output length
```

for the failing run.

Determine whether the response was truncated before increasing retry complexity.

Specifically verify whether the current understanding limit is sufficient for the current, expanded understanding schema.

Do not blindly increase the value.

First establish:

```text
finishReason === length?
```

or equivalent evidence of truncation.

If truncation is confirmed, adjust the understanding output budget appropriately.

If truncation is not the cause, leave the model/token configuration unchanged.

---

# P1.4 — Preserve Existing Retry/Fallback

Do not replace:

```text
ai-adapter.service.ts
```

repair logic.

Do not replace:

```text
llm-runtime.service.ts
```

retry/failover logic.

The change is diagnostic hardening around the existing machinery.

Target:

```text
generateObject
      ↓
failure
      ↓
classify
      ↓
capture diagnostic
      ↓
existing repair/retry
      ↓
existing failover
```

---

# Tests

Use the existing adapter/runtime test patterns (`llm-runtime.service.spec.ts` mocked-adapter pattern).

Mock the adapter/model responses.

## Case 1 — Valid

```text
valid structured response
→ success
```

## Case 2 — Empty

```text
empty output
→ classified EMPTY
→ existing retry/fallback path
```

## Case 3 — Malformed

```text
malformed output
→ classified MALFORMED
→ existing repair path
```

## Case 4 — Schema Invalid

```text
valid JSON
→ schema validation failure
→ classified SCHEMA_INVALID
```

## Case 5 — Diagnostic Persistence

Verify failure metadata contains:

```text
failure classification
raw output sample
finishReason
```

with the raw sample truncated to the configured safe limit.

## Case 6 — Failover

Verify existing behavior still performs:

```text
candidate retry
→ fallback model
```

without introducing a second retry loop.

---

# Integration Regression Test

After all changes, run:

```text
Every 10 minutes, send me a WhatsApp message saying Hello World.
```

Expected successful execution:

```text
USER
 ↓
UNDERSTANDING
 ↓
PLANNING
 ↓
STATIC_VALIDATION
 ↓
BUILDING
 ↓
APPROVAL / PROVISION
```

Expected replan behavior if the initial plan is invalid:

```text
PLANNING
 ↓
STATIC_VALIDATION
 ↓
FAIL
 ↓
validationResult recorded
 ↓
REPLAN
 ↓
PLANNING
 ↓
STATIC_VALIDATION
 ↓
PASS
 ↓
BUILDING
```

No:

```text
BUILDING → PLANNING
```

transition should occur.

---

# Full Regression Gate

Run:

1. `AgentRunService` transition tests.
2. Automation graph tests.
3. Static validation tests.
4. Replan tests.
5. Validation artifact/metadata tests.
6. AI adapter tests.
7. LLM runtime retry/failover tests.
8. Understanding service tests.
9. Existing native-node resolver tests.
10. Existing automation eval dataset.
11. Full test suite.

---

# Constraints

Do NOT:

* add a new phase
* increase `MAX_PLAN_ATTEMPTS`
* add a generic `BUILDING → PLANNING` transition
* create another retry mechanism
* replace the existing model
* replace the existing failover system
* add a new validation database/table
* add another cache
* bypass Zod validation
* bypass `AgentRunService`
* modify n8n
* change the native-node architecture

---

# Implementation Order

```text
1. Phase transition map
       ↓
2. Build passthrough
       ↓
3. Static validation → BUILDING
       ↓
4. Persist validationResult on both failure paths
       ↓
5. Adapter failure diagnostics
       ↓
6. Failure classification
       ↓
7. Verify truncation / maxTokens
       ↓
8. Tests
       ↓
9. Full suite + eval
       ↓
10. WhatsApp regression test
```

---

# Definition of Done

The fix is complete when:

* Static validation happens before `BUILDING`.
* `PLANNING → STATIC_VALIDATION` is valid.
* `STATIC_VALIDATION → BUILDING` is valid.
* `BUILDING → EXECUTING` is valid.
* Replanning does not require `BUILDING → PLANNING`.
* Validation results are persisted before replan.
* Validation results are also persisted when the retry budget is exhausted.
* Understanding failures expose enough diagnostics to identify the root cause.
* Existing LLM repair/retry/failover remains intact.
* Truncation is investigated before adding more retry behavior.
* No invalid understanding reaches the planner.
* Native-node selection remains unchanged.
* `MAX_PLAN_ATTEMPTS=2` remains unchanged.
* The scheduled WhatsApp workflow can complete the normal path.
* The invalid-plan → replan → valid-plan path completes without a state-machine crash.

# Core Principle

Fix the state machine before optimizing the intelligence.

The runtime must first be able to safely do:

```text
Plan
 ↓
Validate
 ↓
Reject
 ↓
Replan
 ↓
Validate
 ↓
Build
```

Only after that should we optimize why the model occasionally fails to produce the structured understanding object.
