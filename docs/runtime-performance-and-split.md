# Runtime Split And Performance

## Scope

This document records the runtime and performance work implemented in
`woops-agent-engine`.

The primary goal is to reduce normal agent-chat latency by ensuring that
conversation requests do not invoke the planner or load execution-only
dependencies before generating a response.

## Runtime Modes

Runtime mode is explicit and selected by the caller. The backend does not use
an LLM classifier before the real response.

Supported modes:

| Mode | Responsibility | Planner | Tools | Side effects |
|---|---|---:|---:|---:|
| `conversation` | Chat, brainstorming, questions, employee exploration | No | No | No |
| `employee_design` | Structured draft employee blueprint | No | No | No |
| `execution` | Planning, approvals, skills, tools, and external work | Yes | Yes | Only when approved |

Missing `mode` values temporarily default to `conversation` for migration
compatibility.

The API contract is defined in:

- `src/modules/runtime/types/runtime.types.ts`
- `src/modules/runtime/dto/execute-run.dto.ts`

## Runtime Routing

The request path is:

```text
RuntimeController
  -> RuntimeRouterService
       -> ConversationRuntimeService
       -> EmployeeDesignRuntimeService
       -> RuntimeService (legacy execution path)
```

The router is implemented in:

- `src/modules/runtime/runtime-router.service.ts`

The controller no longer selects planner behavior based on an LLM result. The
caller must send the intended mode explicitly.

## Conversation Runtime

Implemented in:

- `src/modules/runtime/conversation/conversation-runtime.service.ts`

Conversation mode:

1. Creates a run.
2. Loads the agent profile and bounded conversation history.
3. Builds lightweight context.
4. Retrieves memory and knowledge selectively.
5. Performs one text-generation call or one streaming generation call.
6. Completes the run.
7. Persists conversation messages and noncritical metadata.

Conversation mode does not:

- Call `PlannerService`.
- Load all agent skills.
- Construct tools.
- Load integration credentials.
- Request approval.
- Execute actions.
- Write every brainstorming message to durable memory.

Conversation history is bounded to the most recent 20 messages at the database
query level.

## Streaming API

The existing JSON endpoint remains available:

```text
POST /api/v1/runs
```

Conversation clients can use:

```text
POST /api/v1/runs/stream
Accept: text/event-stream
Content-Type: application/json
```

Streaming is currently supported for `conversation` mode only.

Example request:

```json
{
  "agentId": "employee-id",
  "conversationId": "conversation-id",
  "userMessage": "Help me brainstorm a support employee",
  "mode": "conversation",
  "effort": "medium"
}
```

The SSE event sequence is:

```text
event: run.started
data: {"type":"run.started","runId":"run-id","mode":"conversation"}

event: token
data: {"type":"token","runId":"run-id","content":"Hello"}

event: run.completed
data: {"type":"run.completed","runId":"run-id","response":"Hello...","usage":{}}
```

Failure event:

```text
event: run.failed
data: {"type":"run.failed","runId":"run-id","code":"CONVERSATION_FAILED","message":"..."}
```

The frontend should append `token.content` as it arrives and use
`run.completed` as the final response boundary.

Implementation locations:

- `src/modules/runtime/runtime.controller.ts`
- `src/modules/runtime/conversation/conversation-runtime.service.ts`
- `src/infrastructure/llm-runtime/llm-runtime.service.ts`
- `src/infrastructure/ai-adapter/ai-adapter.service.ts`

The AI adapter and LLM runtime already expose async streaming. The new
controller endpoint exposes that capability over HTTP.

## Parallel Context Loading

Conversation mode loads these independently in parallel:

- Agent profile.
- Conversation history.
- Employee memory.
- Organization knowledge.

Memory and knowledge are retrieved with `Promise.all()` in:

- `src/modules/runtime/services/context-builder.service.ts`

Dependency timeouts:

| Dependency | Timeout | Behavior on timeout |
|---|---:|---|
| Memory | 500ms | Continue without memory |
| Knowledge | 800ms | Continue without knowledge |
| Conversation LLM | 20s | Fail the conversation run |
| Planner LLM | 30s | Fail the planning request |

## Runtime Cache

Implemented in:

- `src/modules/runtime/shared/runtime-cache.service.ts`

Redis is used only as an optimization layer. Cache failures fall back to the
database and never fail a runtime request.

Cached definitions:

| Key | TTL |
|---|---:|
| `runtime:agent:profile:{id}` | 60 seconds |
| `runtime:agent:full:{id}` | 60 seconds |
| `runtime:agent-skills:{id}` | 60 seconds |
| `runtime:skill:{id}` | 300 seconds |

The cache is used by conversation and execution runtime loading paths.

The following are intentionally not cached:

- Authorization decisions.
- Approval state.
- Balances.
- Tool results.
- External business records.
- Destructive-operation state.

The current invalidation strategy is short TTL expiration. Explicit
invalidation on agent and skill mutation should be added when cache ownership
is moved into the agent and skill services.

## Skill Employee Runtime

Implemented in:

- `src/modules/runtime/skill/skill-employee-runtime.service.ts`
- `src/modules/runtime/skill/skill-runtime.errors.ts`

`RuntimeService.executeSkill()` now delegates to the stateless skill runtime.
The orchestration runtime owns plans and runs; the skill runtime owns one
capability invocation.

The skill runtime enforces:

- Skill existence.
- `ACTIVE` skill status.
- Required input fields.
- Basic input schema validation.
- Basic output schema validation.
- Skill timeout.
- Retry policy for transient failures.
- Execution-mode dispatch.
- Approval boundary for `HUMAN_APPROVAL` skills.
- Structured lifecycle logging.

Supported execution modes:

- `AI_ONLY`
- `HYBRID`
- `N8N_WORKFLOW`
- `KNOWLEDGE_RETRIEVAL`
- `MEMORY_RETRIEVAL`
- `HUMAN_APPROVAL`

Structured error codes:

- `SKILL_NOT_FOUND`
- `SKILL_NOT_ACTIVE`
- `INVALID_INPUT`
- `INVALID_OUTPUT`
- `APPROVAL_REQUIRED`
- `DEPENDENCY_MISSING`
- `EXECUTION_TIMEOUT`
- `EXECUTION_FAILED`

Skill lifecycle logs include:

- `skill.started`
- `skill.completed`
- `skill.failed`

Skills do not own memory, conversations, runs, OAuth, channels, or
credentials.

## LLM Retry Policy

`LLMRuntimeService` now defaults to one retry instead of two and uses bounded
exponential delays:

```text
250ms
500ms
1000ms
```

Retryable failures include transient network, timeout, rate-limit, and server
errors.

Failures that are not retried include:

- Authentication failures.
- Authorization failures.
- Permission failures.
- Validation failures.
- Schema failures.
- Invalid input failures.

Conversation and planner operations provide explicit timeouts rather than
depending only on a large global timeout.

LLM execution duration now records an actual duration rather than reusing a
start timestamp as the duration value.

## Persistence Behavior

The JSON conversation endpoint keeps the existing synchronous behavior for
compatibility.

The streaming conversation path completes the run and then starts
noncritical persistence without blocking token delivery:

- Usage update.
- Runtime metadata.
- User message.
- Assistant message.

Memory is not automatically written for normal brainstorming or conversation.
Selective memory extraction remains a future asynchronous job.

Critical execution state remains synchronous in the execution path:

- Approval state.
- Permission checks.
- External-side-effect confirmation.
- Final destructive execution state.

## Avoiding Premature Employee Creation

This repository now supports conversation mode without planner execution, but
the current API still requires an `agentId`.

The remaining product/API work is to support temporary brainstorming sessions:

```text
temporary session
  -> conversation messages
  -> draft blueprint
  -> user confirmation
  -> durable agent creation
```

The current implementation keeps the reviewable blueprint in the design run
metadata and exposes an explicit confirmation endpoint. Confirmation creates a
`DRAFT` agent and stores its approved employee profile as `AGENT` memory. A
dedicated durable blueprint table can still be introduced later if drafts need
independent lifecycle management from runs.

## Tests

Current verification results:

- `npm run typecheck`: passed.
- `npm test`: 386 tests passed.
- `npm run test:e2e`: 30 tests passed.
- `git diff --check`: passed.

Coverage includes:

- Runtime mode routing.
- Conversation isolation from planner and tools.
- Conversation token streaming.
- SSE endpoint behavior.
- Bounded context loading.
- Skill input/output validation.
- Inactive skill rejection.
- Approval-required skill rejection.
- Structured skill errors.
- LLM retry and timeout behavior.
- Existing execution and approval compatibility.

## Remaining Work

1. Update the frontend to consume `/runs/stream` and render token events.
2. Add first-token and total-duration fields to persisted run records.
3. Add explicit cache invalidation on agent and skill mutations.
4. Replace the legacy execution `RuntimeService` with a focused
   `ExecutionRuntimeService`.
5. Add atomic approval transitions and approval idempotency.
6. Add full JSON Schema validation for nested schemas and output contracts.
7. Add capability, permission, and integration dependency services.
8. Add a temporary conversation-session API to avoid premature agent creation.
9. Move usage analytics, memory extraction, and indexing to dedicated BullMQ
   jobs with operation-specific retry policies.
10. Add provider prompt-cache configuration where supported.

## Changed Files

Runtime contracts and routing:

- `src/modules/runtime/types/runtime.types.ts`
- `src/modules/runtime/dto/execute-run.dto.ts`
- `src/modules/runtime/runtime-router.service.ts`
- `src/modules/runtime/runtime.controller.ts`
- `src/modules/runtime/runtime.module.ts`

Conversation and employee design:

- `src/modules/runtime/conversation/conversation-runtime.service.ts`
- `src/modules/runtime/employee-design/employee-design-runtime.service.ts`
- `src/modules/runtime/shared/runtime-cache.service.ts`

Skill execution:

- `src/modules/runtime/skill/skill-employee-runtime.service.ts`
- `src/modules/runtime/skill/skill-runtime.errors.ts`
- `src/modules/runtime/services/runtime.service.ts`

Context and persistence support:

- `src/modules/runtime/services/context-builder.service.ts`
- `src/modules/conversations/repositories/conversations.repository.ts`
- `src/infrastructure/llm-runtime/llm-runtime.service.ts`
- `src/modules/planner/planner.service.ts`

Tests:

- `src/modules/runtime/runtime-router.service.spec.ts`
- `src/modules/runtime/conversation/conversation-runtime.service.spec.ts`
- `src/modules/runtime/skill/skill-employee-runtime.service.spec.ts`
- `src/modules/runtime/services/runtime.service.spec.ts`
- `test/e2e/runtime.e2e-spec.ts`
