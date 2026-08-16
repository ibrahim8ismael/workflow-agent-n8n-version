# Jaafar LangGraph Runtime Migration Plan

Status: In Progress
Owner: Woops Runtime Team
Scope: Jaafar agent runtime replacement

## Implementation Progress

Last updated: 2026-08-15

Completed implementation slices:

- Repository inventory and migration disposition recorded in `docs/jaafar-runtime-inventory.md`.
- Runtime contracts, typed `JaafarState`, checkpoint versioning, and state serialization are defined and tested.
- Prisma `Run` versus LangGraph checkpoint ownership and failure rules are documented in `docs/jaafar-run-checkpoint-mapping.md`.
- LangGraph TypeScript `1.4.9` and PostgreSQL checkpoint support `1.0.4` are installed and locked.
- In-memory and lazy PostgreSQL checkpoint adapters are implemented under `src/infrastructure/langgraph/`.
- Minimal checkpointed graph compilation is covered by a unit test.
- Graph lifecycle event contracts, SSE normalization, and sensitive tool-data redaction are implemented.
- Deterministic harness limits are implemented with environment-backed configuration and structured limit errors.
- Approval policy contracts and decision guards are implemented for read-only, side-effecting, configured, and risky-argument tools.
- PostgreSQL-backed idempotency records are implemented for side-effect start, completion, failure, replay, concurrency, and unknown status handling.
- Tool contracts and a manifest-backed `ToolRegistryService` are implemented and tested.
- R5.2 request understanding contracts, structured classification, missing-input detection, and a conditional LangGraph understanding slice are implemented and tested.
- R5.3 runtime planning contracts, scoped tool planning, plan validation, approval derivation, and graph plan persistence are implemented and tested.
- R5.4 graph model calls use `LLMRuntimeService` and persist structured execution and usage metadata in checkpoint-safe graph state.
- R5.5 tool-loop graph service selects planned tools, invokes `ToolExecutorService`, preserves results, retries recoverable failures, and routes approval and harness failures safely.
- R5.5 final response generation is grounded in tool results and persists assistant responses, usage, and run completion/failure through domain services.
- R6.1 employee-design requirement collection is implemented as a scoped graph branch with persisted session state and blueprint revisions; approval and creation remain on the existing confirmation path.
- R6.2 employee-design blueprint preparation reuses the shared schema and validator, grounds generation in bounded context, and presents the complete review payload with its canonical revision.
- R6.3 confirmation now requires the current blueprint revision, enforces run scope, creates draft employees with profile memory, replays completed confirmations idempotently, and supports an approval checkpoint resume path.
- R7.4 explicit task execution now composes the shared understanding and bounded execution graph services behind `JaafarRuntimeService`; ordinary conversation remains on the staged legacy path.
- R7.4 ordinary conversation and general-question requests now use the shared understanding graph and a graph-backed response service with scoped context and persistence.
- Runtime startup and tool execution now enforce subscription quota checks when billing services are available, with structured `QUOTA_EXCEEDED` errors.
- Billing accounting now runs for completed, waiting, failed, cancelled, and resumed runtime paths through the run accounting service.
- Production graph execution now requires the PostgreSQL checkpointer instead of silently falling back to in-memory state.
- Checkpoint adapter failures and incompatible serialized state are classified without exposing checkpoint contents.
- n8n side-effect calls receive stable idempotency keys and runtime rollout enablement, internal-only mode, and kill-switch configuration are available.
- Runtime memory candidates have a policy filter for confidence, scope, and sensitive-value rejection.
- Runtime event journaling now feeds bounded health counters for run, node, and tool lifecycle signals.
- n8n capabilities now resolve through `N8nIntegrationRegistryService`, enforce organization integration readiness, keep credentials outside graph state, and normalize unavailable integrations into structured tool errors.
- Model provider/model metadata, model duration, and streaming time-to-first-token are recorded by `RuntimeObservabilityService`.
- PostgreSQL checkpoint setup migrations and failure logging are explicit, safe operational boundaries.
- A fixed production-safe evaluation dataset is defined in `docs/jaafar-runtime-evaluation-dataset.json`.
- Active understanding, conversation, execution, and employee-design invocations request durable
  checkpointing outside tests, with checkpoint thread IDs scoped by organization and user.
- Task execution completion and failure persistence is finalized at the runtime boundary after graph
  invocation, and SSE disconnects cancel the active run after its run ID is emitted.
- Legacy runtime providers are registered temporarily so documented old-run drain and compatibility
  paths are available while new requests remain behind `JaafarRuntimeService`.
- A top-level `JaafarGraphService` now owns the shared understanding and route boundary for conversation,
  employee-design, and task requests; branch graph run ownership is the next consolidation step.

Current migration boundary:

- `RuntimeController` now depends on `JaafarRuntimeService`; the facade stages graph and legacy paths behind one public runtime entry point.
- Explicit employee-design requests, task execution, ordinary conversation, and graph-owned approval resumes use LangGraph through `JaafarRuntimeService`. Legacy services remain available only for old/in-flight approvals and domain-side-effect compatibility.
- Legacy runtime services are registered only as temporary compatibility providers for old-run drain; they are not selected for new requests.
- `JaafarGraphService` is the active top-level route boundary; existing branch graphs still own their
  branch-specific run lifecycle until run creation is moved into the top-level graph.
- The understanding, planning, tool execution, conversation response, and employee-design graph slices are available as runtime services, with model-call, session, and approval checkpoint state captured in the graph. Classification failures continue through the conversation graph rather than the legacy runtime.
- Conversation and explicit task SSE now emit normalized graph, tool, approval, waiting, and token-compatible events through the facade.
- Approval and idempotency policies are not enforced by the legacy skill executor; enforcement begins with the new `ToolExecutorService`.

Latest verification after the n8n registry, checkpoint logging, and observability slices:

- 71 unit test files passed, 514 tests passed, with the PostgreSQL restart test skipped when no database is reachable.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run lint:ci` passed.
- `npx prisma validate` passed.
- `npm run test:e2e` passed: 30 tests passed.
- Task-graph stream exceptions persist `FAILED` before emitting the terminal failure event; SSE client disconnects cancel the active run after the first run event.

Remaining work is limited to unified top-level graph/state consolidation, checkpoint retention execution,
production PostgreSQL validation, fixed quality evaluation/baseline measurement, and deletion of
compatibility source after old runs are drained.

Plan closure status:

- [x] Repository-completable runtime, safety, n8n, observability, API, billing, and test work is implemented and documented.
- [x] The fixed production-safe evaluation dataset is present at `docs/jaafar-runtime-evaluation-dataset.json`.
- [!] PostgreSQL restart/checkpoint synchronization requires a reachable deployment database.
- [!] Checkpoint cleanup requires a scheduled production operation and retention ownership.
- [x] Client-disconnect behavior cancels the active run through the SSE controller boundary.
- [!] Quality metrics require a legacy baseline and an evaluation runner.
- [!] Compatibility source removal requires the old-run drain window and rollout approval.

## 1. Executive Summary

Jaafar will move from the current collection of planner, conversation, employee-design, and execution services to one LangGraph-based agent runtime.

LangGraph will become Jaafar's control loop. It will own:

- Request understanding
- Intent classification
- Planning
- Tool selection
- Tool calling
- Multi-step execution
- Human approval interrupts
- Retry and recovery decisions
- Employee design
- Reflection and learning decisions
- Final response generation

Woops domain services remain the source of truth for platform data and business rules. Skills become controlled tools exposed to Jaafar. n8n remains an integration executor behind tools where existing skills require it. Jaafar must not call provider SDKs, databases, or external integrations directly.

The target is a single Jaafar brain with one durable state machine, not multiple runtime implementations selected by a router.

## 2. Current State

The current runtime has several independent decision paths:

```text
RuntimeController
    |
    v
RuntimeRouterService
    |
    +-- ConversationRuntimeService
    +-- EmployeeDesignRuntimeService
    +-- RuntimeService
             |
             +-- PlannerService
             +-- SkillEmployeeRuntimeService
             +-- AI SDK tool loop
```

Current responsibilities are distributed as follows:

- `RuntimeRouterService` chooses a runtime path.
- `ConversationRuntimeService` handles direct conversational generation and streaming.
- `EmployeeDesignRuntimeService` handles blueprint generation, validation, approval, and employee creation.
- `RuntimeService` handles planning, approval, workflow generation, and approved execution.
- `PlannerService` produces structured plans through a separate LLM request.
- `SkillEmployeeRuntimeService` validates and executes skill strategies.
- `LLMRuntimeService` selects models, performs provider failover, and records usage metadata.
- `RunsService` persists run status, plans, metadata, usage, and results.

This works as a set of features, but the architecture has no single durable agent loop. Planning and execution are separate concerns, conversation and employee design use separate flows, and recovery decisions are mostly procedural.

## 3. Target State

```text
HTTP / SSE / future WebSocket transports
                 |
                 v
        JaafarRuntimeService
                 |
                 v
          Jaafar LangGraph
                 |
     +-----------+------------+
     |                        |
  Graph state             Harness policy
     |                        |
     +-----------+------------+
                 |
        Tool registry and executor
                 |
     +-----------+------------+
     |           |            |
  Woops       Memory       Knowledge
 services    service        service
     |
  Skills and integrations
     |
  n8n / external systems
```

The graph is responsible for deciding what to do next. Domain services are responsible for performing authorized operations. The harness limits what the graph is allowed to do.

### 3.1 Affected Areas And Change Boundaries

The runtime is the primary implementation area, but a full Jaafar replacement requires focused changes in the surrounding modules. These modules must expose clean runtime-facing contracts; they must not be rewritten or absorbed into the graph.

| Area | Expected change | Responsibility that remains in the module |
| --- | --- | --- |
| `src/modules/runtime/` | Main LangGraph runtime, graph state, nodes, routing, harness, tools, approval, resume, and events | Jaafar orchestration and execution control |
| `src/modules/conversations/` | Bounded history loading, graph-safe message persistence, and resume-aware conversation methods | Conversation ownership and message persistence |
| `src/modules/memory/` | Runtime retrieval and controlled learning-candidate persistence | Memory access, scope, and retention rules |
| `src/modules/knowledge/` | Runtime retrieval contract and structured context results | Knowledge access control, indexing, and search |
| `src/modules/skills/` | Tool-definition mapping and skill policy exposure | Skill definitions, assignment, and lifecycle |
| `src/modules/runs/` | Checkpoint/run synchronization, tool-call records, event summaries, usage, and resume status | Platform run ownership, status, and persistence |
| `src/modules/agents/` | Scoped agent profile loading and employee creation calls | Agent ownership, profile, and employee domain rules |
| `src/modules/billing/` | Runtime usage, cost, quota, and interruption accounting | Billing policy and quota enforcement |
| `src/modules/integrations/` | Integration readiness contracts exposed to tools | OAuth, credentials, and integration ownership |
| `src/modules/channels/` | Channel readiness contracts exposed to tools | Channel configuration and availability |
| `src/infrastructure/` | LangGraph checkpointer, model adapter, tracing, and provider integration | External libraries and infrastructure adapters |

Change boundary rules:

- The graph must call module services through explicit contracts, not private implementation files.
- The graph must never access Prisma, repositories, credentials, OAuth tokens, or external APIs directly.
- Domain services remain responsible for authorization and must re-check authorization at execution time.
- Supporting modules may gain methods, interfaces, DTOs, schemas, validators, events, or repositories only when required by the new runtime contract.
- Supporting modules must not gain graph orchestration logic.
- LangGraph-specific library code belongs behind the runtime or infrastructure boundary and must not spread through domain modules.
- Existing domain behavior should be preserved unless a documented runtime contract requires a change.
- A module change is complete only when its existing tests and new runtime contract tests pass.

This migration replaces Jaafar's decision and execution control loop. It does not replace the conversations, memory, knowledge, skills, runs, agents, billing, integrations, or channels domains.

### 3.2 Locked Architecture Decisions

- LangGraph TypeScript is Jaafar's single runtime for conversation, employee design, and task execution.
- Vercel AI SDK is the only LLM gateway used by Jaafar.
- LangGraph must not add a second model-provider abstraction through LangChain.
- `LLMRuntimeService` remains the Woops model gateway and continues to use the Vercel AI SDK internally.
- n8n owns integration registration and external workflow execution.
- Jaafar accesses n8n capabilities only through registered, validated Woops tools.
- PostgreSQL is the production LangGraph checkpointer.
- The existing runtime API endpoints remain stable during the migration.

The implementation may refactor these boundaries, but it must not introduce a competing LLM gateway, integration executor, or runtime brain.

## 4. Goals

### Primary Goals

- Make Jaafar one coherent agent across conversation, employee design, and business execution.
- Give Jaafar durable state and resumability across long-running interactions.
- Support structured planning and dynamic tool calling in the same loop.
- Make human approval a first-class graph interrupt.
- Make tool failures recoverable without losing run state.
- Preserve tenant isolation, authorization, billing, and auditability.
- Improve Jaafar through explicit reflection and evaluated behavior.
- Keep model providers replaceable through a model gateway.

### Secondary Goals

- Stream meaningful graph events, not only generated text tokens.
- Support parallel read-only tool calls when safe.
- Persist tool calls and results for debugging and analytics.
- Make every side-effecting operation idempotent.
- Establish a foundation for future scheduled and background runs.

### Non-Goals

- Rebuilding the entire Woops domain model.
- Allowing Jaafar to bypass NestJS authorization or service boundaries.
- Removing n8n on the first migration.
- Creating a multi-agent system in the first version.
- Allowing autonomous policy, permission, billing, or identity changes.
- Replacing PostgreSQL with a separate state database without a concrete need.

## 5. Architectural Principles

1. Jaafar has one runtime graph.
2. Graph state is execution state, not the source of truth for business entities.
3. NestJS domain services remain authoritative for users, organizations, agents, skills, conversations, knowledge, memory, billing, channels, and integrations.
4. All tools are explicitly registered, permission-checked, schema-validated, observable, and bounded.
5. The model never receives unrestricted access to services or credentials.
6. Approval happens before irreversible side effects.
7. Tool execution must be idempotent or guarded by an idempotency key.
8. Provider and model selection remains behind a model gateway.
9. LangGraph nodes should orchestrate; they should not duplicate domain business logic.
10. Every graph transition must be explainable through persisted events and metadata.
11. Memory writes require an explicit policy and should never silently rewrite business rules.
12. A graph failure must result in a recoverable run state and a safe user-facing response.

## 6. Jaafar Graph Design

### 6.1 Main Graph

The main graph will support all Jaafar request types.

```text
START
  |
  v
load_context
  |
  v
understand_request
  |
  v
clarification_required?
  | yes                         | no
  v                             v
prepare_clarification       classify_intent
  |                             |
  v                             +-- conversation
interrupt_or_respond           |
                                +-- employee_design
                                |
                                +-- task_execution
                                |
                                +-- general_question
                                      |
                                      v
                         retrieve_context
                                      |
                                      v
                              plan_or_respond
                                      |
                       +--------------+--------------+
                       |                             |
                 direct response              execution plan
                                                     |
                                                     v
                                             validate_plan
                                                     |
                                             approval_required?
                                               | yes       | no
                                               v           v
                                        approval interrupt execute_loop
                                                           |
                                                           v
                                                    reflect_and_persist
                                                           |
                                                           v
                                                    final_response
                                                           |
                                                          END
```

The graph must be conditional, not a fixed sequence that forces unnecessary planning for a simple conversation.

### 6.2 Employee Design Branch

Employee design is a branch of the same Jaafar graph.

```text
employee_design_intent
        |
        v
load_design_session
        |
        v
collect_requirements
        |
        v
requirements_complete?
    | no                  | yes
    v                     v
ask_user             retrieve_company_context
                            |
                            v
                     draft_blueprint
                            |
                            v
                     validate_blueprint
                            |
                    +-------+-------+
                    |               |
               incomplete       ready
                    |               |
                    v               v
               ask_user      approval interrupt
                                    |
                                    v
                            create_employee_draft
                                    |
                                    v
                            persist_employee_profile
                                    |
                                    v
                              final_response
```

The current employee blueprint schema, validation rules, revision handling, confirmation scope checks, and idempotent creation behavior must be reused or moved into domain-oriented services. LangGraph controls orchestration but does not replace those contracts.

### 6.3 Execution Loop

Approved task execution runs through a bounded loop.

```text
select_next_action
        |
        +-- call_tool
        |      |
        |      v
        |  validate_tool_result
        |      |
        |      +-- retryable failure -> recover_or_retry
        |      +-- approval needed -> approval interrupt
        |      +-- invalid result -> repair_or_fail
        |      +-- success -> update state
        |
        +-- ask_user -> interrupt
        +-- finish -> reflection
```

Jaafar may call multiple tools, but each loop must enforce the harness step and tool-call limits.

## 7. Graph State Contract

The graph state must be typed and versioned.

```ts
type JaafarState = {
  schemaVersion: number;

  run: {
    runId: string;
    agentId: string;
    userId?: string;
    organizationId?: string;
    conversationId?: string;
  };

  request: {
    userMessage: string;
    effort: 'low' | 'medium' | 'high';
    receivedAt: string;
  };

  conversation: {
    history: Message[];
    response?: string;
  };

  understanding: {
    intent?: Intent;
    goal?: string;
    businessContext?: string;
    requirements: Requirement[];
    missingInputs: MissingInput[];
    confidence?: number;
  };

  context: {
    agent?: AgentProfile;
    skills: ToolDefinition[];
    memory: MemoryItem[];
    knowledge: KnowledgeItem[];
    integrations: IntegrationStatus[];
  };

  plan?: ExecutionPlan;
  approval: {
    status: 'not_required' | 'pending' | 'approved' | 'rejected';
    reason?: string;
    requestedAt?: string;
    resolvedAt?: string;
  };

  execution: {
    stepIndex: number;
    toolCalls: ToolCallRecord[];
    results: ToolResultRecord[];
    completed: boolean;
  };

  reflection?: {
    outcome?: 'success' | 'partial' | 'failed';
    summary?: string;
    learningCandidates?: LearningCandidate[];
  };

  errors: RuntimeError[];
};
```

State rules:

- Do not store secrets, access tokens, or raw credentials in checkpoints.
- Store references to platform entities instead of duplicating large records.
- Store enough tool input and output metadata to resume and audit safely.
- Add a schema version before production rollout.
- Reject or migrate unsupported checkpoint versions explicitly.
- Redact sensitive values from logs and graph events.

## 8. Harness Design

The harness is the safety and reliability boundary around the graph.

```ts
type JaafarHarnessPolicy = {
  maxGraphSteps: number;
  maxToolCalls: number;
  maxRetriesPerTool: number;
  maxRuntimeMs: number;
  maxEstimatedCost?: number;
  maxOutputTokens?: number;
  allowParallelReadOnlyTools: boolean;
  requireApprovalFor: string[];
};
```

The harness must enforce:

- Total graph step limits
- Tool-call limits
- Retry limits
- Per-tool timeout
- Total run timeout
- LLM timeout
- Estimated cost limits
- Tool permission checks
- Input and output schema validation
- Approval policy
- Idempotency checks
- Cancellation checks
- Tenant scope checks
- Safe error normalization
- Redaction of secrets and personal data

The harness must be deterministic and testable without an LLM.

## 9. Tool System

### 9.1 Tool Definition

Every skill exposed to Jaafar must be converted into a tool definition containing:

- Stable tool ID
- Human-readable name
- Slug
- Description
- Input JSON schema
- Output JSON schema
- Skill instructions
- Execution mode
- Required permissions
- Required integrations
- Approval requirement
- Timeout
- Retry policy
- Idempotency policy
- Success criteria

### 9.2 Tool Categories

Initial categories:

- Knowledge retrieval
- Memory retrieval
- AI-only skill
- Hybrid skill
- n8n workflow
- Human approval
- Employee management
- Conversation and response support

### 9.3 n8n Integration Registry And Executor

n8n remains the integration registry and external execution system. LangGraph does not call n8n webhooks directly and does not manage OAuth or credentials.

The n8n boundary must:

- Synchronize or read available integration capabilities.
- Expose safe tool definitions to the Woops tool registry.
- Validate required integrations and permissions.
- Resolve the correct n8n workflow for a tool.
- Execute the workflow with bounded timeout and retry behavior.
- Normalize successful results into the tool result contract.
- Normalize n8n failures into classified runtime errors.
- Support idempotency for side-effecting workflows.
- Keep credentials, OAuth tokens, and provider-specific payload details outside graph state.

The existing `ToolManifestService`, `tools.json`, and `SkillEmployeeRuntimeService` are starting points for this boundary. Their useful behavior should be extracted into the tool registry and executor without allowing n8n-specific details to spread through graph nodes.

### 9.4 Tool Execution Pipeline

Every call follows this sequence:

```text
Jaafar selects tool
        |
        v
resolve tool manifest
        |
        v
check tenant and permissions
        |
        v
check integration readiness
        |
        v
validate input
        |
        v
check approval policy
        |
        v
create idempotency record
        |
        v
execute tool
        |
        v
validate output
        |
        v
persist tool result
        |
        v
return observation to graph
```

The existing `SkillEmployeeRuntimeService` behavior for retries, timeouts, validation, knowledge, memory, and n8n calls should be extracted into this tool pipeline.

### 9.4 Side Effects

Side-effecting tools must:

- Require an explicit tool policy.
- Use a stable idempotency key derived from run and logical action.
- Persist started, completed, and failed states.
- Avoid repeating an already completed action when a graph resumes.
- Require human approval where configured.
- Return a structured result suitable for audit and recovery.

## 10. Model Gateway

LangGraph nodes must use the Woops Vercel AI SDK gateway rather than directly instantiating provider clients or LangChain model classes.

The model gateway is responsible for:

- Execution mode selection
- Provider and model resolution
- Provider failover
- Timeouts
- Retries
- Token usage
- Estimated cost
- Model execution metadata
- Structured output support
- Streaming support

`LLMRuntimeService` is the gateway for this migration. It may be reorganized internally, but it must remain the only model gateway used by Jaafar. Provider resolution and usage accounting must not be duplicated in graph nodes, tools, or n8n adapters.

Target boundary:

```text
Jaafar graph
    |
    v
LLMRuntimeService
    |
    v
Vercel AI SDK
    |
    +-- OpenAI
    +-- Anthropic
    +-- Google
    +-- Groq
```

## 11. Persistence and Checkpointing

PostgreSQL is the recommended production checkpointer because Woops already depends on PostgreSQL and needs durable, inspectable run state.

### Checkpoint Responsibilities

- Persist graph state after resumable transitions.
- Support approval interrupts.
- Support process restart recovery.
- Support retry and cancellation.
- Support checkpoint versioning.
- Scope checkpoints by run, user, and organization.

### Prisma Run Responsibilities

`Run` remains responsible for:

- Ownership and tenant scope
- Public status
- Plan and result summaries
- Usage and cost metadata
- Approval status summary
- Error summary
- API retrieval
- Billing and analytics references

The graph checkpoint and `Run` update must be coordinated so that the API never reports a completed run while the graph state is incomplete.

### Suggested Persistence Additions

Evaluate the need for these tables or equivalent JSON fields:

- `runtime_checkpoints`
- `runtime_events`
- `runtime_tool_calls`
- `runtime_idempotency_keys`
- `runtime_interrupts`

Use existing `Run.metadata` only for a short transition period. High-volume events and tool calls should not be placed indefinitely into one JSON document.

## 12. API and Transport Behavior

The public API should remain stable during the migration.

### Start Run

`POST /api/v1/runs`

Behavior:

- Create or resolve the conversation.
- Create the platform run.
- Start Jaafar's graph.
- Return the current run state, including waiting or completed status.

### Approve Run

`POST /api/v1/runs/:id/approve`

Behavior:

- Verify access and approval scope.
- Load the graph checkpoint.
- Resolve the approval interrupt.
- Resume Jaafar.
- Return the new graph and run state.

### Reject Run

`POST /api/v1/runs/:id/reject`

Behavior:

- Verify access.
- Record rejection reason.
- Resume the graph with a rejected decision or safely terminate it.
- Do not execute pending side effects.

### Confirm Employee Design

`POST /api/v1/runs/:id/confirm`

Behavior:

- Verify user and organization scope.
- Resolve the employee-design approval interrupt.
- Resume the graph.
- Create the employee through the domain service.
- Return the created employee reference.

### Streaming

`POST /api/v1/runs/stream`

Events should include:

- `run.started`
- `graph.node.started`
- `graph.node.completed`
- `plan.created`
- `approval.required`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `token`
- `run.waiting`
- `run.completed`
- `run.failed`

The existing token event contract should remain supported for clients that only render assistant text.

## 13. Run Lifecycle

The run status model must map cleanly to graph state.

```text
CREATED
  -> PREPARING
  -> PLANNING
  -> WAITING       clarification or approval
  -> EXECUTING
  -> COMPLETED
  -> FAILED
  -> CANCELLED
```

Rules:

- `WAITING` must always include a resumable reason.
- `EXECUTING` must have a current graph checkpoint.
- `COMPLETED` must have a final response and persisted usage.
- `FAILED` must include a safe error code and retryability classification.
- `CANCELLED` must prevent future side effects from the old checkpoint.
- Status transitions must be idempotent.

## 14. Memory and Learning

Jaafar should improve through controlled learning, not unrestricted self-modification.

### Read Path

Before planning, Jaafar may retrieve:

- Agent profile
- Organization context
- Relevant conversation history
- Relevant long-term memory
- Relevant knowledge documents
- Relevant prior run outcomes

### Write Path

After execution, a reflection node may produce learning candidates such as:

- Stable user preferences
- Stable business facts
- Reusable workflow preferences
- Corrections explicitly provided by the user
- Skill execution observations

Candidates must be filtered before persistence. Jaafar must not automatically persist:

- Credentials
- Secrets
- Unverified assumptions
- Temporary emotional statements
- Authorization decisions
- Business policies without confirmation
- Sensitive personal data without policy support

Memory writes should include source, confidence, scope, and expiration where appropriate.

## 15. Security and Permissions

The graph must run within the authenticated scope supplied by the controller.

Required checks:

- User identity
- Active organization
- Agent ownership or assignment
- Skill assignment
- Tool permissions
- Integration ownership
- Channel ownership
- Knowledge access
- Memory access
- Approval ownership
- Run ownership

The graph state must never be trusted as an authorization source. Every side-effecting tool must re-check authorization through the relevant domain service at execution time.

Prompt instructions are not security controls. Permissions must be enforced in code.

## 16. Error Handling and Recovery

Errors should be classified into:

- `INVALID_REQUEST`
- `MISSING_INPUT`
- `PERMISSION_DENIED`
- `INTEGRATION_NOT_READY`
- `TOOL_NOT_FOUND`
- `INVALID_TOOL_INPUT`
- `INVALID_TOOL_OUTPUT`
- `TOOL_TIMEOUT`
- `TOOL_RETRY_EXHAUSTED`
- `MODEL_TIMEOUT`
- `MODEL_PROVIDER_FAILURE`
- `APPROVAL_REQUIRED`
- `GRAPH_LIMIT_REACHED`
- `CHECKPOINT_FAILURE`
- `UNKNOWN_RUNTIME_FAILURE`

Recovery policy:

- Retry transient model and network failures within configured limits.
- Do not retry validation, permission, or authentication failures automatically.
- Ask the user when a missing input or decision is required.
- Request approval before escalating to an irreversible action.
- Preserve completed tool results when later steps fail.
- Return partial progress where safe and useful.
- Never hide a failed side effect behind a successful final response.

## 17. Observability

Each run should have a trace containing:

- Run ID
- Graph execution ID
- Node name
- Node duration
- Model execution ID
- Provider and model metadata
- Prompt and completion usage
- Estimated cost
- Tool name
- Tool duration
- Retry count
- Approval events
- Checkpoint IDs
- Final status

Sensitive values must be redacted. Store hashes or references where raw payloads are not needed.

Metrics:

- Run completion rate
- Run failure rate
- Clarification rate
- Approval rate
- Tool success rate
- Tool retry rate
- Average graph steps
- Average tool calls per run
- Time to first token
- Time to completion
- Token cost per run
- Cost by agent and organization
- Duplicate side-effect prevention count
- Memory write acceptance rate

## 18. Code Organization

Proposed structure:

```text
src/modules/runtime/
  controllers/
    runtime.controller.ts
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
    jaafar-runtime.interface.ts
    jaafar-state.interface.ts
    tool.interface.ts
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

Structure rules:

- Use the existing `runtime` feature module rather than creating `src/jaafar/`, `src/agents/`, or another parallel application root.
- Use the standard repository folders; omit unused folders rather than adding speculative folders.
- Keep graph orchestration in runtime services and graph-specific types in runtime interfaces, schemas, validators, constants, events, and types.
- Keep LangGraph library and provider adapters in infrastructure.
- Keep controllers thin, repositories free of business logic, and Prisma access inside repositories only.
- Keep individual services below the repository target of 300 lines; split files when they have separate reasons to change.
- Use kebab-case for all new file and folder names.

The following existing code should be migrated and then removed from the active runtime path:

- `RuntimeRouterService`
- `RuntimeService` as the old executor
- `ConversationRuntimeService`
- `EmployeeDesignRuntimeService` as a separate runtime
- `PlannerService` as a separate planning authority

Useful domain logic should be extracted before deletion. Avoid keeping compatibility branches that allow old and new graphs to make different decisions.

## 19. Migration Strategy

### Phase 0: Baseline and Contracts

Deliverables:

- Record the current verification baseline before changing runtime behavior.
- Inventory current runtime files and assign each file an explicit migration disposition.
- Document current API and status behavior.
- Freeze the current run response contract.
- Add characterization tests around conversation, execution, approval, and employee design.
- Define graph state, tool contracts, harness policy, and event types.
- Define checkpoint and idempotency requirements.

Exit criteria:

- Baseline recorded in `docs/jaafar-runtime-inventory.md`: 44 test files and 411 tests pass; typecheck, build, and `lint:ci` pass.
- Runtime inventory and file dispositions are recorded in `docs/jaafar-runtime-inventory.md`.
- Existing behavior is covered by tests.
- New graph boundaries are reviewed.

### Phase 1: LangGraph Foundation

Deliverables:

- Add LangGraph TypeScript dependencies only.
- Do not add LangChain model-provider packages.
- Add a PostgreSQL production checkpointer.
- Add an in-memory test checkpointer.
- Add graph state serialization and versioning.
- Add `JaafarRuntimeService` and graph factory.
- Add graph event normalization.
- Add harness enforcement.
- Connect graph model calls to `LLMRuntimeService` through the Vercel AI SDK.

Exit criteria:

- A test graph can start, checkpoint, interrupt, resume, and complete.
- Step and timeout limits are enforced.

### Phase 2: Tool Platform

Deliverables:

- Define `ToolDefinition`, `ToolCall`, `ToolResult`, and tool error contracts.
- Convert skill manifests into tools.
- Extract validation, retry, timeout, and n8n execution into the tool executor.
- Connect the tool registry to the n8n integration registry.
- Keep n8n as the only external integration executor.
- Add permission and integration checks.
- Add idempotency records for side-effecting tools.
- Add tool event persistence.

Exit criteria:

- Existing skills execute through the new tool executor.
- Tool input/output validation and retry tests pass.

### Phase 3: Conversation and Planning

Deliverables:

- Implement context loading.
- Implement request understanding and intent classification.
- Implement structured plan generation.
- Implement direct conversational response.
- Implement the bounded tool loop.
- Preserve conversation persistence and usage tracking.

Exit criteria:

- Normal conversations use only the new graph.
- Task requests can plan, call tools, recover, and complete.
- No conversation request uses `ConversationRuntimeService`.

### Phase 4: Employee Design

Deliverables:

- Move employee design into a graph branch.
- Reuse blueprint schema and validation.
- Support clarification interrupts.
- Support approval and confirmation interrupts.
- Create employee drafts through `AgentsService`.
- Persist employee profile memory through `MemoryService`.
- Preserve creation idempotency and scope checks.

Exit criteria:

- The complete employee-design vertical slice works after process restart.
- Duplicate confirmation cannot create duplicate employees.

### Phase 5: API and Streaming Cutover

Deliverables:

- Point `RuntimeController` to `JaafarRuntimeService`.
- Replace router approval calls with checkpoint resume calls.
- Emit normalized graph events through SSE.
- Preserve existing client-compatible events.
- Add cancellation and reconnect behavior.

Exit criteria:

- All public runtime endpoints use the Jaafar graph.
- No endpoint directly invokes the old runtime services.

### Phase 6: Remove Old Runtime

Deliverables:

- Remove old router decision logic.
- Remove separate conversation runtime.
- Remove separate employee-design runtime.
- Remove separate planner execution path.
- Delete obsolete tests and replace them with graph tests.
- Update README and architecture documentation.

Exit criteria:

- There is one runtime entry point.
- There is one planning authority.
- There is one tool-calling loop.

### Phase 7: Evaluation and Improvement

Deliverables:

- Add fixed scenario evaluation suite.
- Add run replay from checkpoints.
- Add tool-call quality metrics.
- Add regression datasets from production-safe conversations.
- Tune prompts, routing, harness, and tool descriptions based on measured failures.

Exit criteria:

- Jaafar quality is measured against the baseline.
- Every regression has a reproducible test or evaluation case.

## 20. Testing Strategy

### Unit Tests

- State reducers and serializers
- Graph route conditions
- Harness limits
- Approval policies
- Tool registry
- Tool permission checks
- Input and output validation
- Retry classification
- Idempotency keys
- Error normalization
- Memory write filtering

### Graph Tests

- Conversation path
- Clarification path
- Employee-design path
- Task planning path
- Approval interrupt and resume
- Rejection path
- Tool success
- Tool retry
- Tool failure
- Tool output repair or failure
- Graph limit reached
- Checkpoint reload
- Process restart simulation

### Integration Tests

- PostgreSQL checkpointer
- Runs and checkpoint synchronization
- Conversation persistence
- Skills and tool manifests
- Knowledge retrieval
- Memory retrieval and writes
- n8n adapter
- Billing usage events
- Tenant isolation

### End-to-End Scenarios

1. User asks a simple business question.
2. User asks an ambiguous question and Jaafar asks one focused clarification.
3. User asks to create an employee with missing requirements.
4. User completes employee requirements and reviews a blueprint.
5. User confirms an employee blueprint after a process restart.
6. User requests a task requiring one read-only tool.
7. User requests a task requiring multiple tools.
8. A tool times out and is retried.
9. A tool returns invalid output.
10. An integration is unavailable.
11. A side effect is resumed after a network failure without duplication.
12. A user attempts to access another user's run.
13. A run exceeds its graph or cost budget.
14. A user rejects an approval request.
15. Jaafar responds in the user's language.

## 21. Rollout and Cutover

The final target is full replacement, but rollout should still be controlled.

Recommended controls:

- Feature flag for graph runtime activation.
- Organization-level rollout percentage.
- Admin-only internal testing first.
- Shadow evaluation where safe, without executing side effects twice.
- Automatic fallback only before side effects begin.
- Kill switch that stops new graph runs.
- Checkpoint and event retention policy.
- Explicit migration version for in-flight old runs.

Old runs must not be resumed by a graph with incompatible state. Choose one policy and document it:

- Finish old runs on the old code until drained.
- Migrate old waiting runs into graph state.
- Cancel and ask users to restart affected runs.

The recommended policy is to drain or explicitly cancel old runs before removing their execution code. Do not silently reinterpret old plans.

## 22. Operational Limits

Initial defaults should be configurable per environment and eventually per organization plan:

- Maximum graph steps: 30
- Maximum tool calls: 15
- Maximum retries per tool: 2
- Maximum total runtime: 5 minutes for synchronous runs
- Maximum high-effort model time: 120 seconds per call
- Maximum parallel tool calls: read-only tools only
- Maximum output size: configured by response contract
- Maximum estimated cost: enforced by billing policy

These values are starting points, not permanent product rules. They must be measured and tuned.

The initial environment-backed harness keys are `JAAFAR_MAX_GRAPH_STEPS`, `JAAFAR_MAX_TOOL_CALLS`, `JAAFAR_MAX_RETRIES_PER_TOOL`, `JAAFAR_MAX_RUNTIME_MS`, `JAAFAR_MAX_ESTIMATED_COST`, `JAAFAR_MAX_OUTPUT_TOKENS`, and `JAAFAR_ALLOW_PARALLEL_READ_ONLY_TOOLS`.

Approval policy configuration uses `JAAFAR_APPROVAL_REQUIRED_TOOLS`, a comma-separated list of stable tool IDs or slugs that always require approval.

Runtime rollout configuration uses `JAAFAR_RUNTIME_ENABLED`, `JAAFAR_RUNTIME_KILL_SWITCH`, and
`JAAFAR_RUNTIME_INTERNAL_ONLY`. The defaults keep the graph enabled for authenticated traffic;
the kill switch and internal-only mode are intended for controlled rollout and incident response.

## 23. Risks and Mitigations

### Infinite or Expensive Loops

Mitigation: harness step, call, time, token, and cost limits.

### Duplicate Side Effects

Mitigation: idempotency keys, persisted tool-call state, and resume-safe executors.

### Lost Approval State

Mitigation: durable PostgreSQL checkpoints and explicit interrupt records.

### Authorization Bypass

Mitigation: domain-service checks at execution time; never trust graph state alone.

### Provider Lock-In

Mitigation: model gateway behind LangGraph nodes.

### Prompt Injection Through Knowledge or Tool Results

Mitigation: separate trusted instructions from untrusted content, restrict tool permissions, validate outputs, and treat retrieved content as data.

### Incorrect Memory Learning

Mitigation: explicit memory candidate filtering, confidence, source tracking, and user correction support.

### Operational Complexity

Mitigation: one graph, typed nodes, structured events, replayable tests, and clear service boundaries.

### Incompatible In-Flight Runs

Mitigation: checkpoint versioning and a documented old-run drain policy.

## 24. Definition Of Done

The migration is complete when all of the following are true:

- Jaafar has one production runtime entry point.
- LangGraph owns planning and tool-calling control flow.
- Conversation, employee design, and task execution use the same graph runtime.
- Graph state survives application restarts.
- Approval interrupts can resume safely.
- Tool calls are permission-checked and schema-validated.
- Side-effecting tools are idempotent.
- Existing run and conversation APIs remain functional.
- SSE exposes graph and tool lifecycle events.
- Usage and estimated cost are persisted.
- Memory writes are policy-controlled.
- n8n is accessed only through registered tools.
- Old runtime decision paths are removed.
- Unit, graph, integration, and end-to-end tests pass.
- Jaafar evaluation results meet or exceed the agreed baseline.
- Documentation, deployment configuration, and operational runbooks are updated.

## 25. First Implementation Milestone

Build the complete employee-design vertical slice first:

```text
User request
    -> understand
    -> identify employee-design intent
    -> gather missing requirements
    -> retrieve context
    -> generate blueprint
    -> validate blueprint
    -> interrupt for approval
    -> resume from PostgreSQL checkpoint
    -> create employee draft
    -> persist employee profile memory
    -> final response
```

This milestone proves the most important runtime capabilities at once:

- One Jaafar graph
- Typed durable state
- Structured output
- Conditional routing
- Human approval
- Resume after interruption
- Tool and domain-service boundaries
- Idempotent side effects
- Conversation and run persistence

After this slice is stable, migrate ordinary conversation and general task execution into the same graph rather than creating additional runtime branches.
