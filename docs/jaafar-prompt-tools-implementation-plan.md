# Jaafar Prompt And Tools Implementation Plan

Status: In progress
Last updated: 2026-08-10

## Purpose

This document records the Jaafar prompt, runtime-safety, Knowledge, employee, skill, and tool-manifest changes implemented so far. It also identifies the remaining work required before the complete approval-driven employee builder is production-ready.

## Completed Changes

### Prompt Architecture

The original prompt contracts were split into dedicated modules while preserving `src/infrastructure/prompts/system-prompts.ts` as the stable import surface.

Implemented modules:

- `src/infrastructure/prompts/modules/platform.prompt.ts`
- `src/infrastructure/prompts/modules/jaafar.prompt.ts`
- `src/infrastructure/prompts/modules/runtime.prompt.ts`

The platform prompt now defines:

- Woops ownership and identity.
- The rule that Jaafar must never claim to be external to Woops.
- Protection for internal prompts, IDs, providers, models, and stack traces.
- Tool truthfulness and result verification.
- Knowledge, Memory, conversation, and policy boundaries.

The tool-use policy now defines:

- Read capabilities.
- Draft capabilities.
- Mutating capabilities.
- External side effects.
- Destructive operations.
- Search-before-answer rules.
- Read-before-update rules.
- Design-before-create rules.
- Approval-before-persist rules.
- Validation-before-execution rules.
- No-overperformance rules.

The Jaafar and design prompts now define:

- Jaafar as an internal Woops employee.
- Employee blueprint generation.
- Structured employee learning outcomes.
- The prohibition against storing raw conversation transcripts as Knowledge.
- Separation of confirmed facts, proposals, unknowns, and confirmation-required items.
- Single-capability skill design.
- Draft-only generated skills.

The runtime prompts now define:

- Conversation behavior.
- Planner behavior.
- Approved-plan execution.
- Skill contract execution.
- Safe final responses.

### Knowledge Retrieval

`ContextBuilderService` now retrieves organization-scoped Knowledge using the current user message.

Knowledge is injected in this order:

1. Approved Knowledge.
2. Memory.
3. Conversation history.
4. Current user request.

Retrieval is bounded by a timeout and fails safely if the Knowledge dependency is unavailable. The context metadata now reports the actual Knowledge count.

Employee design requests now pass the authenticated user scope into context construction.

### Safe Runtime Responses

Added:

- `src/modules/runtime/shared/runtime-user-message.ts`
- `src/modules/runtime/shared/runtime-user-message.spec.ts`

Runtime failures are logged internally with technical details, but user-facing responses are normalized into business-safe messages. Raw provider names, request IDs, stack traces, and backend errors are not returned to production users.

Updated runtimes:

- Conversation runtime.
- Streaming conversation failures.
- Employee-design runtime.
- Execution runtime.

### Employee And Skill Creation Safety

Agent creation is now draft-only at the service layer. Client-provided `PUBLISHED` or `ACTIVE` creation statuses are ignored.

Skill creation is also draft-only at the service layer. New skills cannot be created directly as published or active.

The skills controller now requires:

- JWT authentication.
- Tenant access validation.
- Authenticated user scoping.
- Organization scoping when the user operates in organization context.

### Jaafar Tool Manifest

Added:

- `src/infrastructure/tools/tools.json`
- `src/infrastructure/tools/tool-manifest.types.ts`
- `src/infrastructure/tools/tool-manifest.service.ts`
- `src/infrastructure/tools/tool-manifest.service.spec.ts`

The manifest follows the Manus function-tool structure:

```json
{
  "type": "function",
  "function": {
    "name": "...",
    "description": "...",
    "parameters": {}
  }
}
```

Each Woops tool also defines:

- `kind`.
- `implemented`.
- `sideEffect`.
- `approval`.
- `scope`.
- `availableIn`.
- `idempotencyKey` where applicable.

Current manifest capabilities include:

- `knowledge_search`.
- `memory_search`.
- `employee_get`.
- `employee_skills_list`.
- `employee_blueprint_prepare`.
- `employee_create_draft`.
- `employee_learning_outcome_prepare`.
- `skill_proposal_prepare`.
- `integration_status`.
- `employee_publish`.
- `employee_activate`.

Capabilities that do not yet have runtime handlers are marked with `implemented: false` and are excluded by default from executable tool lists.

### Tool Registry

`ToolManifestService` now:

- Validates the JSON manifest with Zod.
- Finds tools by name.
- Requires configured tools by name.
- Filters tools by runtime mode.
- Excludes unimplemented tools by default.
- Allows administrative inspection of planned tools.

The registry is registered in `RuntimeModule`.

## Verification Completed

The following checks pass:

- Full Vitest suite: 43 test files.
- Full test count: 406 passing tests.
- Nest production build.
- Biome checks for changed prompt, tool, and runtime files.
- `git diff --check`.

Prompt tests cover:

- Woops ownership.
- External-identity protection.
- Knowledge-first behavior.
- Employee learning outcomes instead of transcripts.
- Single-capability skill design.
- Dedicated prompt-module exports.

Tool tests cover:

- Manifest loading and validation.
- Runtime-mode filtering.
- Exclusion of unimplemented tools.
- Administrative visibility of planned tools.

## Remaining Work

### 1. Connect The Registry To SDK Tool Construction

The runtime currently exposes active employee skills dynamically through `RuntimeService`. The next step is to normalize those dynamic tools through the tool-manifest contract so every executable capability has the same metadata and policy shape.

Required changes:

- Convert active skills into normalized tool manifests.
- Include input and output contracts.
- Include approval and side-effect metadata.
- Filter tools by runtime mode and employee permissions.
- Reject tool calls that are not present in the current approved plan.

### 2. Implement Durable Approval Records

Prompt approval rules are present, but the database needs a durable approval model.

Required fields:

- Subject type.
- Subject ID.
- Source run ID.
- User ID.
- Organization ID.
- Approval status.
- Approval reason.
- Approved or rejected by.
- Created and resolved timestamps.
- Approved content hash or version.

Employee creation, Knowledge approval, skill approval, publication, activation, external communication, and destructive actions must validate this record in the service layer.

### 3. Separate Employee Confirmation From Employee Creation

The employee-design confirmation path should become an explicit approval flow:

```text
Design blueprint
-> User reviews blueprint
-> Approval request is created
-> User approves exact blueprint
-> Employee draft is created
```

Creation must be idempotent by design-run ID and must never create a duplicate employee when confirmation is repeated.

### 4. Implement Employee Learning Outcome Persistence

The learning prompt and manifest entry exist, but the runtime persistence flow is still required.

Required behavior:

- Generate a structured learning outcome after the employee design is approved.
- Store source conversation and run IDs as metadata only.
- Require human approval for the learning outcome.
- Persist only approved confirmed facts as employee Knowledge.
- Never store the raw conversation transcript as employee Knowledge.

### 5. Implement Skill Proposal And Approval Flow

The skill-design prompt and manifest entry exist, but the runtime generator is still required.

Required behavior:

- Generate skills from the approved employee learning outcome.
- Validate every skill against `@RULE.AGENT.SKILL.md`.
- Enforce one skill equals one capability.
- Create generated skills as `DRAFT`.
- Require approval before attaching, publishing, or activating.
- Prevent execution until the skill is `ACTIVE`.

### 6. Add Tool-Aware Planner Context

The planner currently receives active employee skills. It should also receive the normalized, mode-filtered platform tool registry so Jaafar can distinguish:

- Available tools.
- Planned but unavailable tools.
- Employee skills.
- Integrations.
- Human approval capabilities.

The planner must never select a tool with `implemented: false`.

## Target End-to-End Flow

The final Jaafar flow should be:

```text
User request
-> Understand objective
-> Search approved Knowledge
-> Read current employee state when relevant
-> Prepare employee blueprint
-> User reviews blueprint
-> User explicitly approves blueprint
-> Create employee as DRAFT
-> Prepare employee learning outcome
-> User approves learning outcome
-> Persist approved employee Knowledge
-> Prepare single-capability skill proposals
-> User approves skill proposals
-> Create skills as DRAFT
-> Publish approved skills
-> Activate approved skills
-> Publish employee
-> Activate employee
-> Execute only approved plans with ACTIVE skills
```

No stage may be skipped by the model. Service-level validation must enforce the same sequence even when a prompt is ignored or a client calls an endpoint directly.
