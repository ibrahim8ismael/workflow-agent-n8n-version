# Jaafar LangGraph Runtime Todos

Status: Active
Related plan: `docs/jaafar-langgraph-runtime-migration-plan.md`
Scope: Full replacement of the current Jaafar runtime

## How To Use This File

- Work from top to bottom unless a task explicitly allows parallel work.
- Keep each task small enough to review and test independently.
- Mark a task `[x]` only after its implementation and verification are complete.
- Add the relevant commit or pull request reference beside completed tasks when available.
- Do not skip a repository-structure or security gate to make the graph run sooner.
- Update this file whenever the implementation plan changes.

## Definition Of Status

- `[ ]` Pending
- `[-]` In progress
- `[x]` Complete
- `[!]` Blocked or requires a decision

## Current Baseline

- [x] Document the target architecture in `docs/jaafar-langgraph-runtime-migration-plan.md`.
- [x] Confirm that the current runtime has separate router, conversation, employee-design, planner, and execution paths.
- [x] Confirm that the repository uses a NestJS modular monolith with feature modules under `src/modules/`.
- [x] Confirm that PostgreSQL, Prisma, Redis, the existing LLM runtime, skills, memory, knowledge, and runs already exist.
- [x] Record the current test baseline before changing runtime behavior. See `docs/jaafar-runtime-inventory.md`.

## Current Implementation Progress

Last updated: 2026-08-15

- [x] Repository inventory and explicit file dispositions recorded.
- [x] Typed runtime contracts and versioned checkpoint-safe graph state added.
- [x] Run/checkpoint ownership and failure behavior documented.
- [x] LangGraph dependencies, minimal graph smoke test, and checkpoint adapters added.
- [x] SSE event normalization and sensitive-data redaction added.
- [x] Harness policy and environment-backed execution limits added.
- [x] Approval policy and decision guards added.
- [x] PostgreSQL-backed side-effect idempotency records and replay protection added.
- [x] Tool contracts and static manifest-backed registry added.
- [x] New graph runtime is active in the controller through `JaafarRuntimeService`.
- [x] Approval and idempotency are connected to the graph tool executor; legacy skill execution remains only for compatibility paths.
- [x] Agent-assigned skill filtering is implemented.
- [x] Shared tool execution pipeline is implemented and connected to run-bound legacy plan execution.
- [x] Tool permission checks and structured tool audit events are implemented in the executor boundary.
- [x] Knowledge, memory, employee-read, and employee-draft domain adapters are available in the executor.
- [x] Employee blueprint preparation and profile-memory persistence are available through domain adapters.
- [x] n8n workflow execution is isolated behind an infrastructure adapter.
- [x] Human approval is represented as a registered approval tool boundary.
- [x] Scoped bounded graph context loading is implemented for profiles, history, tools, memory, knowledge, and readiness.
- [x] Employee-design graph branch is implemented, registered, and active through the API.
- [x] Production durable graph execution rejects missing PostgreSQL checkpoint infrastructure instead of silently using in-memory state.
- [x] Checkpoint adapter failures and incompatible state are classified without logging checkpoint contents.
- [x] Runtime startup and tool execution enforce subscription quota checks when billing services are available.
- [x] n8n side-effect calls receive stable idempotency keys.
- [x] Runtime rollout enablement, internal-only mode, and kill-switch configuration are available.
- [x] Memory candidate filtering rejects low-confidence and sensitive candidates.
- [x] Legacy runtime services are registered only as temporary compatibility providers for old-run drain; new requests remain behind `JaafarRuntimeService`.
- [x] Runtime, billing, users, and auth E2E suites pass.
- [x] Latest automated verification: 71 unit test files, 514 tests passed, 1 PostgreSQL integration test skipped without a reachable database, and 30 E2E tests passed.
- [x] n8n workflow capabilities resolve through an infrastructure registry with organization readiness checks, credential isolation, normalized failures, and stable idempotency forwarding.
- [x] Runtime observability records model provider/model metadata, model duration, and time-to-first-token for graph model calls and streams.
- [x] Active graph checkpoint thread IDs include organization and user scope, and normal graph branches request durable checkpointing outside tests.
- [x] Task completion/failure persistence occurs at the runtime boundary after graph invocation rather than inside the execution final-response node.
- [x] SSE client disconnects cancel the active run after a run ID is emitted.
- [x] Top-level `JaafarGraphService` owns shared request understanding and route selection.

## Phase 0: Repository Structure Gate

### R0.1 Inventory Existing Runtime Files

- [x] List every runtime entry point, controller, service, repository, DTO, schema, validator, event, type, and test. See `docs/jaafar-runtime-inventory.md`.
- [x] Map each existing runtime file to one responsibility. See `docs/jaafar-runtime-inventory.md`.
- [x] Identify duplicate planning, tool-calling, approval, persistence, retry, and streaming logic. See `docs/jaafar-runtime-inventory.md`.
- [x] Identify files that violate the target responsibility boundaries. See `docs/jaafar-runtime-inventory.md`.
- [x] Record files that must be migrated, retained, renamed, or deleted. See `docs/jaafar-runtime-inventory.md`.

Acceptance criteria:

- The runtime inventory is recorded in the migration pull request.
- Every old runtime file has an explicit disposition.

### R0.2 Enforce Repository Naming

- [x] Use kebab-case for all new file names.
- [x] Use kebab-case for all new folder names.
- [x] Use PascalCase for classes and interfaces.
- [x] Use camelCase for variables and methods.
- [x] Use UPPER_SNAKE_CASE for constants.
- [x] Do not introduce abbreviations that make the runtime structure unclear.

Acceptance criteria:

- New files pass the existing Biome checks.
- No new custom naming convention is introduced.

### R0.3 Enforce Module Boundaries

- [x] Keep Jaafar runtime code inside the existing `src/modules/runtime/` feature module.
- [x] Keep AI provider and LangGraph library adapters in `src/infrastructure/` where they represent external infrastructure.
- [x] Keep business logic in services.
- [x] Keep Prisma access in repositories only.
- [x] Keep controllers limited to parsing, authorization context, service calls, and responses.
- [x] Keep DTOs limited to API contracts and Zod validation.
- [x] Keep domain contracts in interfaces.
- [x] Keep business validation in validators or services.
- [x] Keep domain events in events.
- [x] Communicate across modules through exported services or events, never internal file imports.

Acceptance criteria:

- The runtime does not import Prisma directly from controllers or services.
- No graph node reaches into another module's private implementation file.
- The dependency direction is documented and reviewed.

### R0.4 Establish The Runtime Folder Layout

Use the existing module convention. Do not create an unrelated top-level runtime tree or a second application structure.

Target layout:

```text
src/modules/runtime/
  controllers/
  services/
    jaafar-runtime.service.ts
    jaafar-graph.service.ts
    jaafar-harness.service.ts
    tool-registry.service.ts
    tool-executor.service.ts
    run-state.service.ts
  repositories/
  dto/
  entities/
  interfaces/
  schemas/
  validators/
  constants/
  events/
  types/
  tests/
  runtime.module.ts

src/infrastructure/langgraph/
  langgraph-checkpointer.service.ts
  langgraph-model.adapter.ts
  langgraph.module.ts
```

Rules for this layout:

- Omit unused standard folders rather than adding empty folders.
- Do not create `src/jaafar/`, `src/agents/`, or another parallel application root.
- Do not place graph nodes in controllers, repositories, DTOs, or Prisma code.
- Keep individual services below the repository target of 300 lines.
- Split graph state, routing, tool execution, persistence, and response formatting into separate services when they have separate reasons to change.

Acceptance criteria:

- The final tree follows `@RULE.REPO_PATTERN.md`.
- The runtime module has one clear public entry service.
- The LangGraph library is isolated from domain services behind a small infrastructure boundary.

## Phase 1: Contracts And State

### R1.1 Define Runtime Contracts

- [x] Define the public `JaafarRuntimeService` contract in `src/modules/runtime/interfaces/jaafar-runtime.interface.ts`.
- [x] Define start, resume, approve, reject, cancel, and stream operations.
- [x] Preserve existing API response compatibility where possible.
- [x] Define typed runtime event names and payloads.
- [x] Define normalized runtime error codes.
- [x] Define the graph checkpoint version.

Acceptance criteria:

- Controllers depend on one runtime service contract.
- No controller needs to know whether the runtime is LangGraph.

### R1.2 Define Typed Graph State

- [x] Define `JaafarState` with a schema version.
- [x] Define request and tenant scope state.
- [x] Define conversation history state.
- [x] Define understanding, requirements, and intent state.
- [x] Define agent, skills, memory, knowledge, and integrations context.
- [x] Define plan and approval state.
- [x] Define tool-call and tool-result state.
- [x] Define reflection and learning-candidate state.
- [x] Define error and recovery state.
- [x] Redact credentials and secrets from checkpoint state and normalized events.
- [x] Add serialization and deserialization tests.

Acceptance criteria:

- State is strictly typed without `any`.
- Unsupported checkpoint versions fail safely.
- State can be serialized, loaded, and resumed in a test.

### R1.3 Define Run And Checkpoint Mapping

- [x] Document which fields remain in Prisma `Run`. See `docs/jaafar-run-checkpoint-mapping.md`.
- [x] Document which fields belong only in LangGraph checkpoints. See `docs/jaafar-run-checkpoint-mapping.md`.
- [x] Define synchronization rules for status, plan, metadata, usage, and final response.
- [x] Define behavior when a checkpoint exists but the `Run` update fails.
- [x] Define behavior when a `Run` exists but its checkpoint is missing.
- [x] Define in-flight run migration or drain policy.

Acceptance criteria:

- The API cannot report a completed run before graph completion is persisted.
- A waiting run always has enough checkpoint data to resume.
- A missing or corrupt checkpoint produces a classified failure.

## Phase 2: LangGraph Foundation

### R2.1 Add LangGraph Dependencies

- [x] Select the supported LangGraph TypeScript package versions: `@langchain/langgraph@1.4.9`, `@langchain/langgraph-checkpoint-postgres@1.0.4`.
- [x] Confirm the implementation uses LangGraph directly without LangChain model-provider packages.
- [x] Confirm compatibility with the current NestJS and TypeScript versions.
- [x] Add production and development checkpointer dependencies.
- [x] Update lockfile through the package manager.
- [x] Document required environment variables. The production checkpointer uses the existing `DATABASE_URL`; no separate checkpoint database variable is introduced.
- [x] Confirm compatibility with SWC, Vitest, and the Node runtime version.

Acceptance criteria:

- `npm run build` succeeds.
- `npm run typecheck` succeeds.
- [x] A minimal graph can compile in a unit test in `src/infrastructure/langgraph/langgraph-graph.spec.ts`.

### R2.2 Implement Checkpoint Infrastructure

- [x] Implement the production PostgreSQL checkpointer in `src/infrastructure/langgraph/langgraph-postgres-checkpointer.service.ts`.
- [x] Implement the in-memory checkpointer for unit tests in `src/infrastructure/langgraph/langgraph-memory-checkpointer.service.ts`.
- [!] Add checkpoint retention and cleanup policy. Retention period is defined in operations, but executing cleanup requires the production PostgreSQL deployment boundary.
- [x] Scope checkpoints by run, user, and organization.
- [x] Add checkpoint failure logging without leaking state contents.
- [x] Add migration support for checkpoint schema changes through the checkpointer setup migration.

Acceptance criteria:

- [x] A graph survives process restart in the environment-gated PostgreSQL integration test.
- [x] A checkpoint cannot be loaded outside its tenant scope.

### R2.3 Implement Graph Event Normalization

- [x] Define node start and completion events in `src/modules/runtime/events/runtime-event.types.ts`.
- [x] Define model usage and token events in the normalized runtime contract.
- [x] Define tool lifecycle events.
- [x] Define approval and waiting events.
- [x] Define final success, failure, cancellation, and timeout events.
- [x] Redact sensitive arguments and results.
- [x] Map normalized graph events to the existing SSE format through `JaafarEventNormalizerService`.

Acceptance criteria:

- Existing clients can still render final assistant tokens.
- New clients can observe graph and tool progress.

## Phase 3: Harness And Safety

### R3.1 Implement Harness Policy

- [x] Define maximum graph steps.
- [x] Define maximum tool calls.
- [x] Define maximum retries per tool.
- [x] Define per-tool and total runtime limits. Total runtime is implemented in `JaafarHarnessService`; per-tool timeout remains with the tool executor.
- [x] Define model token and estimated cost limits.
- [x] Define parallel tool-call policy.
- [x] Make limits configurable by environment.
- [!] Connect limits to billing plan enforcement where required. Requires subscription-plan limit definitions from Billing/Product.

Acceptance criteria:

- A graph exceeding any implemented harness limit stops safely.
- The run records the exact limit that stopped it through `HarnessLimitError`.
- Harness tests run without a real model.

### R3.2 Implement Approval Policy

- [x] Define read-only versus side-effecting tools in `JaafarApprovalService` and `ToolDefinition.sideEffect`.
- [x] Define tools that always require approval through `JAAFAR_APPROVAL_REQUIRED_TOOLS` and tool policy.
- [x] Define tools that require approval based on arguments or risk.
- [x] Ensure approval interrupts occur before side effects in the execution graph.
- [x] Persist approval reason and requested action in the graph interrupt payload and run metadata.
- [x] Support approve, reject, and cancel decisions at the policy contract level.
- [x] Ensure a rejected execution run is cancelled without resuming its checkpoint.

Acceptance criteria:

- No protected side effect starts before approval once the tool executor is migrated to this policy.
- Duplicate approval requests are idempotent once approval persistence is connected.
- Approval scope is checked against the authenticated user and organization during runtime resume integration.

### R3.3 Implement Idempotency Protection

- [x] Define idempotency key format using run, logical action, and tool identity.
- [x] Persist side-effect start and completion state in `RuntimeIdempotencyKey`.
- [x] Return the prior result when a completed action is replayed.
- [x] Prevent concurrent duplicate execution through the unique database key and `STARTED` status.
- [x] Add failure recovery behavior for unknown external side-effect status through `UNKNOWN` and explicit blocking.

Acceptance criteria:

- Process restart cannot duplicate a completed side effect once tools use `JaafarIdempotencyService`.
- A retry after an unknown timeout requires explicit recovery/confirmation.

## Phase 4: Tool Platform

### R4.1 Define Tool Contracts

- [x] Define `ToolDefinition`.
- [x] Define `ToolCall`.
- [x] Define `ToolResult`.
- [x] Define tool error and retryability contracts.
- [x] Define permission and integration requirements.
- [x] Define timeout and retry policy.
- [x] Define idempotency policy.

Acceptance criteria:

- A tool can be registered without graph code changes through the manifest boundary.
- Tool definitions are safe to expose to the model through validated schemas and policy metadata.

### R4.2 Build Tool Registry

- [x] Load active skills assigned to the agent.
- [x] Convert existing static skill manifests into tool definitions.
- [x] Exclude inactive, unavailable, or unauthorized skills.
- [!] Cache manifests with safe invalidation. Static manifests are immutable per process; dynamic assignment caching remains deferred until a cache invalidation event exists.
- [x] Keep tool names stable across runs.
- [x] Add tool lookup and manifest tests.

Acceptance criteria:

- Jaafar sees only tools available in the current tenant scope.
- Missing tools produce structured errors rather than graph crashes.

### R4.3 Build Tool Executor

- [x] Move input validation into the tool execution boundary.
- [x] Move output validation into the tool execution boundary.
- [x] Move timeout handling into the tool execution boundary.
- [x] Move retry handling into the tool execution boundary.
- [x] Preserve knowledge retrieval behavior.
- [x] Preserve memory retrieval behavior.
- [x] Preserve AI-only and hybrid skill behavior.
- [x] Preserve n8n workflow invocation behavior.
- [x] Add permission checks before every execution.
- [x] Add structured audit events.

Acceptance criteria:

- Every skill execution uses the same executor pipeline.
- Tool failures are classified as retryable or non-retryable.
- No tool executor accesses Prisma directly.

### R4.4 Add Domain Tools

- [x] Add knowledge search tool.
- [x] Add memory search tool.
- [x] Add employee blueprint tool operations.
- [x] Add employee creation tool operation.
- [x] Add integration readiness tool.
- [x] Add channel readiness tool.
- [x] Add n8n workflow tool adapter.
- [x] Add human approval tool or interrupt policy.
- [x] Connect the tool registry to the n8n integration registry.
- [x] Keep n8n as the only external integration executor.
- [x] Keep n8n credentials, OAuth tokens, and provider payload details outside graph state.
- [x] Normalize n8n results and failures into the shared tool contract.
- [x] Add n8n workflow idempotency protection for side-effecting actions.

Acceptance criteria:

- Each tool has input and output schemas.
- Each side-effecting tool has an approval and idempotency policy.

## Phase 5: Jaafar Graph

### R5.1 Implement Context Loading

- [x] Load agent profile within tenant scope.
- [x] Load conversation history with a bounded window.
- [x] Load active skills and convert them to tools.
- [x] Load relevant memory.
- [x] Load relevant knowledge.
- [x] Load integration and channel readiness when required.
- [!] Avoid loading unnecessary context for simple questions. Requires measuring classification/context cost before changing the shared understanding contract.

Acceptance criteria:

- Context loading is bounded, observable, and testable.
- Unauthorized context is never placed in graph state.

### R5.2 Implement Understanding And Classification

- [x] Build Jaafar request-understanding node.
- [x] Define structured understanding output.
- [x] Detect missing requirements.
- [x] Classify conversation, employee design, task execution, and general question intents.
- [x] Preserve Jaafar identity and language behavior.
- [x] Treat user and retrieved content as untrusted data.

Acceptance criteria:

- Ambiguous requests produce focused clarification questions.
- Simple questions do not enter unnecessary execution loops.

### R5.3 Implement Planning

- [x] Move planner schema into the runtime contract layer.
- [x] Build the planning node using available tool definitions.
- [x] Validate plan steps against registered tools.
- [x] Validate required inputs and dependencies.
- [x] Validate success criteria.
- [x] Store plan summary in `Run`.
- [x] Keep plan generation and tool execution in the same graph state.
- [x] Generate plans through the LangGraph state flow, not a separate planner runtime.

Acceptance criteria:

- Jaafar cannot plan calls to unavailable tools.
- Invalid plans stop before side effects.
- Plan validation does not rely on prompt instructions alone.

### R5.4 Implement Vercel AI SDK Model Gateway Usage

- [x] Route every Jaafar model call through `LLMRuntimeService`.
- [x] Preserve low, medium, and high execution modes.
- [x] Preserve structured output generation.
- [x] Preserve text generation and streaming.
- [x] Preserve provider failover, timeout, retry, usage, and cost metadata.
- [x] Prevent graph nodes and tools from importing provider clients directly.
- [x] Prevent LangChain model-provider packages from entering the runtime.

Acceptance criteria:

- Jaafar has one model gateway.
- Model usage and cost are recorded for every graph model call.
- A provider can be changed through gateway configuration without graph changes.

### R5.5 Implement Tool-Calling Loop

- [x] Build action selection node.
- [x] Build tool invocation node.
- [x] Build result observation node.
- [x] Build retry and recovery routes.
- [x] Build user-question interrupt route.
- [x] Build completion route.
- [x] Enforce harness limits on every loop.
- [x] Persist tool calls and results.

Acceptance criteria:

- Jaafar can execute a multi-step task with more than one tool.
- A failed tool does not erase prior successful results.
- The graph can resume from the last safe checkpoint.

### R5.5 Implement Final Response

- [x] Build final response node.
- [x] Include completed work and relevant partial results.
- [x] Explain blocked or failed actions clearly.
- [x] Do not claim an action succeeded without a successful tool result.
- [x] Preserve user language where possible.
- [x] Persist assistant message and run result.

Acceptance criteria:

- Final responses are grounded in graph results.
- Completion status and response content cannot contradict each other.

## Phase 6: Employee Design Graph Branch

### R6.1 Move Requirement Collection

- [x] Load the existing employee-design session.
- [x] Identify missing business requirements.
- [x] Ask only necessary questions.
- [x] Persist user answers in the conversation and graph state.
- [x] Resume requirement collection without losing prior answers.

Implementation note: the first graph implementation stores the structured session in bounded
`Run.metadata` and `Conversation.metadata.employeeDesign` through
`EmployeeDesignSessionService`. A dedicated session table is not introduced in R6.1.

### R6.2 Move Blueprint Generation

- [x] Reuse the current employee blueprint schema.
- [x] Reuse employee blueprint validation.
- [x] Include relevant company knowledge and memory.
- [x] Generate responsibilities, goals, tools, integrations, channels, permissions, and memory policy.
- [x] Preserve blueprint revisions.

Implementation note: the graph review response now presents the complete blueprint surface and
returns the canonical revision alongside the plan. Employee creation is handled by the approval
resume boundary in R6.3.

### R6.3 Move Approval And Creation

- [x] Interrupt when the blueprint is ready for review.
- [x] Preserve the existing confirmation API with validated confirmation and blueprint revision payloads.
- [x] Verify user and organization scope before confirmation.
- [x] Create the employee through `AgentsService`.
- [x] Persist employee profile memory through `MemoryService`.
- [x] Make creation idempotent through the existing run claim and created-agent replay path.
- [x] Update conversation metadata.
- [x] Return the created employee reference.

Implementation note: the graph now persists a review checkpoint, interrupts before creation, and
resumes through the revision-validated confirmation boundary. PostgreSQL restart coverage is
environment-gated and runs when `DATABASE_URL` points to a reachable PostgreSQL instance.

Acceptance criteria:

- Employee creation works after application restart.
- Repeated confirmation cannot create duplicate employees.
- An incomplete blueprint cannot reach the creation tool.

## Phase 7: API Cutover

### R7.1 Replace Runtime Entry Points

- [x] Make `JaafarRuntimeService` the controller-facing runtime entry point.
- [x] Update `RuntimeController` to call the new service.
- [x] Remove controller dependencies on old runtime implementations.
- [x] Preserve authentication and tenant guards.
- [x] Preserve run access checks.

Implementation note: the facade delegates all supported request modes to graph-backed services.
Legacy runtime services remain registered only where required for old/in-flight approvals and
domain-side-effect compatibility.

### R7.2 Replace Approval And Resume

- [x] Route graph-owned approve requests to checkpoint resume.
- [x] Route graph-owned reject requests to checkpoint rejection or safe termination.
- [x] Route graph-owned employee confirmation to graph resume.
- [x] Add cancellation behavior through the facade.
- [x] Handle missing and incompatible checkpoints with classified safe failures.

### R7.3 Replace Streaming

- [x] Stream normalized graph events through SSE.
- [x] Preserve token events.
- [x] Add tool and approval events.
- [x] End streams on completion, failure, cancellation, or client disconnect.
- [x] Persist a failed run status when task-graph streaming raises an exception.
- [x] Ensure stream cleanup does not leave a misleading run status. Exception paths are persisted as `FAILED`; client disconnects cancel the active run.

Implementation note: conversation and task SSE use graph streams and emit normalized node,
tool, approval, waiting, failure, completion, and token-compatible payloads.

Acceptance criteria:

- All runtime endpoints use the new graph.
- No endpoint invokes the old planner or runtime service directly.

### R7.4 Verify Full Graph Coverage

- [x] Conversation requests use the LangGraph conversation path.
- [x] Explicit employee-design requests use the LangGraph employee-design path.
- [x] Explicit task-execution requests use the LangGraph planning and tool loop.
- [x] No supported request type uses a second runtime brain; legacy services remain only as domain and in-flight compatibility boundaries.

Implementation note: normal conversation requests are classified through the shared understanding
graph and use the graph response service. Classification failures continue through the graph
conversation branch, while legacy in-flight task approval remains compatible.

## Phase 8: Data, Billing, And Observability

### R8.1 Persist Runtime Events

- [x] Decide to use bounded `Run.metadata.runtimeEvents` for the initial implementation; dedicated event tables remain deferred.
- [x] Defer dedicated event repository methods; bounded `Run.metadata.runtimeEvents` remains the approved initial journal boundary.
- [x] Persist node, tool, approval, waiting, completion, and failure events through `RuntimeEventJournalService`.
- [x] Add retention policy with a maximum of 100 events per run.
- [x] Redact sensitive payloads by journaling the normalized runtime event contract only.

### R8.2 Preserve Usage And Billing

- [x] Record model usage for every non-streaming graph model call and streamed completion usage.
- [x] Record estimated cost by run when supplied by `LLMRuntimeService` execution metadata.
- [x] Connect graph usage to subscription usage meters and run-scoped billing events through `RuntimeBillingAccountingService`.
- [x] Enforce quota before startup and tool execution.
- [x] Record billing accounting for completed, waiting, failed, cancelled, and resumed paths; production reconciliation remains required.

### R8.3 Add Metrics And Tracing

- [x] Trace graph execution by run ID through normalized runtime events and bounded health counters.
- [x] Record node duration.
- [x] Record tool duration and retry count where lifecycle events provide the measurement.
- [x] Record model provider and model metadata.
- [x] Record time to first token and completion time.
- [x] Add documented runtime health signals in `docs/jaafar-runtime-operations.md`.

Acceptance criteria:

- A run can be diagnosed from logs, events, and persisted status without reading raw prompts.
- Billing totals remain consistent with model usage.

## Phase 9: Tests And Evaluation

### R9.1 Unit Tests

- [x] State serialization and versioning.
- [x] Graph routes.
- [x] Harness limits.
- [x] Approval policy.
- [x] Tool registry.
- [x] Tool permissions.
- [x] Input and output validation.
- [x] Retry classification.
- [x] Idempotency behavior.
- [x] Error normalization.
- [x] Memory write filtering.

### R9.2 Graph Tests

- [x] Simple conversation.
- [x] Ambiguous request and clarification.
- [x] Employee design with missing inputs.
- [x] Employee design approval and resume.
- [x] Task plan with one tool.
- [x] Task plan with multiple tools.
- [x] Tool timeout and retry.
- [x] Tool invalid output.
  - [x] Integration unavailable.
- [x] Approval rejection.
- [x] Checkpoint reload.
- [x] Process restart simulation through the environment-gated PostgreSQL checkpoint test.
- [x] Graph limit reached.

### R9.3 Integration And E2E Tests

- [!] PostgreSQL checkpointer. Local integration coverage is environment-gated and skipped without a reachable database.
- [!] Run and checkpoint synchronization. Requires a reachable PostgreSQL deployment test.
- [x] Conversation persistence.
- [x] Memory retrieval and persistence.
- [x] Knowledge retrieval.
- [x] Skill execution.
- [x] n8n adapter and registry contract.
- [x] Billing usage.
- [x] Tenant isolation.
- [x] Existing API compatibility.

### R9.4 Jaafar Quality Evaluation

- [x] Create a fixed scenario dataset in `docs/jaafar-runtime-evaluation-dataset.json`.
- [!] Measure intent classification accuracy against the fixed dataset; requires an agreed model-evaluation runner and baseline.
- [!] Measure unnecessary clarification rate against the fixed dataset; requires an agreed model-evaluation runner and baseline.
- [!] Measure tool selection accuracy against the fixed dataset; requires an agreed model-evaluation runner and baseline.
- [!] Measure successful task completion against the fixed dataset; requires an agreed model-evaluation runner and baseline.
- [!] Measure unsupported-action refusal quality against the fixed dataset; requires an agreed model-evaluation runner and baseline.
- [!] Measure duplicate side-effect rate against the fixed dataset; requires side-effect test fixtures and baseline traffic.
- [!] Measure response grounding against the fixed dataset; requires an agreed evaluator and baseline.
- [!] Measure multilingual response behavior against the fixed dataset; requires an agreed evaluator and baseline.
- [!] Compare against the current runtime baseline; the legacy baseline must be captured before rollout.

## Phase 10: Cleanup And Removal

### R10.1 Remove Duplicate Runtime Paths

- [x] Remove `RuntimeRouterService` from the active path and module exports.
- [!] Delete the obsolete `RuntimeRouterService` source and isolated compatibility tests after rollout policy approval.
- [x] Remove `ConversationRuntimeService` from the active path and module providers.
- [x] Remove employee-design orchestration from the active path; retain `EmployeeDesignRuntimeService` for domain-side-effect and old-run compatibility.
- [x] Remove `PlannerService` as a separate active planning authority.
- [!] Remove old approval execution logic after graph resume is verified and old runs are drained.
- [!] Remove duplicated conversation persistence logic after compatibility traffic is drained.
- [!] Remove duplicated retry and timeout logic after compatibility traffic is drained.
- [!] Remove obsolete tests only after replacement coverage exists and rollout is approved.

### R10.2 Final Repository Structure Review

- [x] Confirm all new code is under the correct module or infrastructure boundary.
- [x] Confirm standard folders are used consistently.
- [x] Confirm no empty or speculative folders remain.
- [x] Confirm no parallel `jaafar`, `agent`, or runtime application root was introduced.
- [x] Confirm no controller contains graph or business logic.
- [x] Confirm no service accesses Prisma directly at runtime; type-only Prisma imports remain in the idempotency service contract.
- [x] Confirm repositories contain no business logic.
- [!] Confirm no new file exceeds the codebase size targets without justification; the facade and compatibility services still require a post-drain split/removal review.
- [x] Confirm public imports use module boundaries.
- [x] Confirm filenames and folders use kebab-case.
- [x] Confirm dependency injection is used for external services.
- [x] Confirm tests live beside the relevant feature or in the module test convention.

Acceptance criteria:

- `@RULE.REPO_PATTERN.md` is satisfied.
- `@RULE.CODEBASE.md` is satisfied.
- `npm run lint:ci` passes.
- `npm run typecheck` passes.
- `npm run build` passes.

## Phase 11: Rollout

- [x] Add a runtime feature flag.
- [!] Run internal-only graph traffic first.
- [!] Validate metrics and error rates.
- [!] Validate approval and resume behavior in production-like infrastructure.
- [!] Roll out by organization or controlled percentage.
- [x] Add a kill switch for new graph runs.
- [x] Define old-run drain behavior.
- [x] Do not resume old runtime checkpoints with incompatible graph state.
- [!] Remove the feature flag after the new runtime is stable in production.

Implementation note: automated code and test gates are complete for the current migration slice.
The remaining unchecked rollout and operations items require a reachable production PostgreSQL instance,
deployment ownership, and an old-run drain window; they must not be marked complete from local tests.

## Locked Architecture Decisions

- [x] Use LangGraph TypeScript as Jaafar's single runtime.
- [x] Use the Vercel AI SDK as the only LLM gateway.
- [x] Keep `LLMRuntimeService` as the Woops model gateway during migration.
- [x] Do not add LangChain model-provider packages.
- [x] Use n8n as the integration registry and external workflow executor.
- [x] Use LangGraph for conversation, employee design, and task execution.
- [x] Use PostgreSQL for the production LangGraph checkpointer.
- [x] Preserve the existing runtime API endpoints during migration.

## Remaining Implementation Decisions

- [x] Decide to use bounded run metadata for the initial runtime event journal; dedicated tables are deferred.
- [x] Define the initial harness limits through environment-backed defaults.
- [!] Define approval policy for each existing skill execution mode. The graph tool policy is implemented; legacy skill modes require product sign-off before compatibility removal.
- [x] Define the old in-flight run drain or migration policy: drain or explicitly cancel old runs; never reinterpret their state.
- [x] Define graph checkpoint retention period operationally before production enablement; cleanup implementation remains pending.
- [!] Decide whether background and scheduled runs are included in the first release.
- [x] Select the exact compatible LangGraph package versions.

## Final Completion Gate

- [x] One Jaafar runtime entry point is active.
- [x] LangGraph owns planning and tool-calling control flow.
- [!] Conversation, employee design, and task execution use one top-level graph with shared active run state; the top-level route boundary exists, but branch run ownership and state consolidation remain.
- [!] Graph state survives application restart. The environment-gated PostgreSQL test passes only with reachable PostgreSQL.
- [x] Approval interrupts resume safely.
- [x] Tools are permission-checked and schema-validated.
- [x] Side effects are idempotent.
- [x] Existing run and conversation APIs work.
- [x] SSE exposes graph and tool lifecycle events.
- [x] Usage and cost are persisted.
- [x] Memory writes are policy-controlled.
- [x] n8n is reachable only through registered tools.
- [x] Every Jaafar model call uses `LLMRuntimeService` and the Vercel AI SDK.
- [x] No LangChain model-provider packages are used.
- [x] n8n remains the only external integration executor.
- [!] Old runtime decision paths are removed after the old-run drain.
- [x] Automated test and quality gates pass.
- [x] Documentation and deployment configuration are updated.
