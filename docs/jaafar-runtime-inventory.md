# Jaafar Runtime Inventory

Status: Baseline and foundation progress recorded
Date: 2026-08-11
Related plan: `docs/jaafar-langgraph-runtime-migration-plan.md`

## Current Test Baseline

Commands were run before runtime changes:

| Command | Result |
| --- | --- |
| `npm test -- --reporter=verbose` | 44 files passed, 411 tests passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; 347 files compiled |
| `npm run lint:ci` | Passed; 364 files checked |

## Latest Foundation Verification

After the contract, checkpoint, event, harness, approval, idempotency, and tool-registry slices:

| Command | Result |
| --- | --- |
| `npm test -- --reporter=dot` | 53 files passed, 442 tests passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm run lint:ci` | Passed |
| `npx prisma validate` | Passed |

## Active Runtime Entry Points

| File | Current responsibility | Migration disposition |
| --- | --- | --- |
| `src/modules/runtime/runtime.controller.ts` | Parses runtime requests, creates conversations, applies access checks, exposes run and SSE endpoints | Retain endpoint surface; change dependencies to `JaafarRuntimeService`; remove direct Prisma type import |
| `src/modules/runtime/runtime-router.service.ts` | Selects conversation, employee-design, or execution runtime; performs planner-based employee-design routing | Remove after graph cutover; routing moves into graph conditions |
| `src/modules/runtime/services/runtime.service.ts` | Creates runs, plans execution, handles approval, invokes AI SDK tool loop, persists results and memory | Replace with split graph/runtime services; extract reusable persistence and execution behavior first |
| `src/modules/runtime/conversation/conversation-runtime.service.ts` | Direct conversation generation, token streaming, conversation persistence | Extract context, response, persistence, and streaming behavior; remove as independent runtime |
| `src/modules/runtime/employee-design/employee-design-runtime.service.ts` | Blueprint generation, validation, approval, employee creation, profile memory persistence | Extract into employee-design graph nodes and domain-facing operations; remove as independent runtime |
| `src/modules/runtime/skill/skill-employee-runtime.service.ts` | Skill validation, AI/knowledge/memory/n8n execution, timeout, retry, and error normalization | Extract into `ToolExecutorService` and domain tool adapters |

## Runtime Supporting Files

| File | Current responsibility | Migration disposition |
| --- | --- | --- |
| `src/modules/runtime/services/context-builder.service.ts` | Builds model context from prompts, history, memory, and knowledge | Adapt into bounded graph context-loading service |
| `src/modules/runtime/shared/runtime-cache.service.ts` | Redis-backed best-effort runtime cache | Retain behind context/tool registry services where still useful |
| `src/modules/runtime/shared/runtime-user-message.ts` | Converts internal failures to user-safe messages | Retain and extend for normalized runtime error codes |
| `src/modules/runtime/constants/runtime.constants.ts` | Legacy runtime status constants | Replace or align with run and graph lifecycle constants |
| `src/modules/runtime/interfaces/runtime.interface.ts` | Legacy runtime entity interfaces | Replace with public runtime and graph contracts |
| `src/modules/runtime/types/runtime.types.ts` | Runtime modes and request type | Adapt into start/resume/runtime request contracts |
| `src/modules/runtime/types/workflow.types.ts` | Converts plans into workflow definitions for execution | Review; remove if graph state becomes the execution authority |
| `src/modules/runtime/repositories/runtime.repository.ts` | Empty repository placeholder | Delete unless a runtime-specific persistence contract requires it |
| `src/modules/runtime/dto/execute-run.dto.ts` | Start-run API schema | Retain and adapt only for stable API compatibility |
| `src/modules/runtime/dto/confirm-employee-design.dto.ts` | Employee confirmation API schema | Retain and adapt to graph resume contract |
| `src/modules/runtime/employee-design/employee-blueprint.validation.ts` | Backend blueprint field validation | Retain or move to runtime validators; remain outside graph orchestration |
| `src/modules/runtime/employee-design/employee-blueprint-revision.ts` | Blueprint revision helper | Retain or move to runtime contract/validator area |
| `src/modules/runtime/skill/skill-runtime.errors.ts` | Skill-specific error types and codes | Normalize into shared tool/runtime error contracts |

## Existing Runtime Tests

| File | Coverage | Migration disposition |
| --- | --- | --- |
| `src/modules/runtime/runtime-router.service.spec.ts` | Legacy mode routing and planner-based routing | Replace with graph route tests after equivalent coverage exists |
| `src/modules/runtime/services/runtime.service.spec.ts` | Legacy planning, approval, execution, and persistence | Split into graph, harness, tool executor, and run-state tests |
| `src/modules/runtime/conversation/conversation-runtime.service.spec.ts` | Conversation generation and token streaming | Convert to graph conversation and normalized event tests |
| `src/modules/runtime/employee-design/employee-design-runtime.service.spec.ts` | Blueprint, confirmation, idempotent creation, and persistence | Convert to employee-design graph, checkpoint, resume, and domain integration tests |
| `src/modules/runtime/skill/skill-employee-runtime.service.spec.ts` | Skill validation, execution modes, output validation, and errors | Convert to tool registry/executor tests |
| `src/modules/runtime/services/context-builder.service.spec.ts` | Context construction and retrieval fallback | Retain as context-loading tests |
| `src/modules/runtime/shared/runtime-user-message.spec.ts` | Safe runtime error messaging | Retain and extend for normalized errors |
| `src/modules/runtime/dto/confirm-employee-design.dto.spec.ts` | Confirmation payload validation | Retain as API contract coverage |

## Separate Planning Authority

| File | Current responsibility | Migration disposition |
| --- | --- | --- |
| `src/modules/planner/planner.service.ts` | Separate LLM plan generation and basic plan validation | Move schema and validation into runtime contracts/graph planning; remove as separate authority |
| `src/modules/planner/interfaces/plan.interface.ts` | Plan and planner input contracts | Adapt into runtime plan/tool contracts |
| `src/modules/planner/planner.module.ts` | Provides and exports `PlannerService` | Remove after runtime no longer imports the planner module |
| `src/modules/planner/planner.service.spec.ts` | Planner generation and validation tests | Split into graph planning and plan validation tests |

## Infrastructure And Domain Boundaries

| File or area | Current responsibility | Migration disposition |
| --- | --- | --- |
| `src/infrastructure/llm-runtime/llm-runtime.service.ts` | Vercel AI SDK model gateway, provider behavior, usage metadata, text/object/stream generation | Retain as the only model gateway; graph nodes must use its contract |
| `src/infrastructure/llm-runtime/*` tests and interfaces | Model gateway contract and tests | Retain and add graph adapter contract tests as needed |
| `src/infrastructure/tools/tool-manifest.service.ts` | Loads and filters `tools.json` manifests | Adapt into runtime tool registry boundary |
| `src/infrastructure/tools/tool-manifest.types.ts` | Manifest contracts | Adapt into `ToolDefinition` contracts |
| `src/infrastructure/tools/tools.json` | Static tool manifest definitions | Retain only where compatible with domain-backed registry behavior |
| `src/infrastructure/prompts/*` | Prompt construction for Jaafar, planner, skills, and platform behavior | Retain useful prompt content; move graph-specific prompt contracts behind runtime services |
| `src/modules/runs/` | Run creation, status, plan/result/usage/metadata persistence, approval claim behavior | Extend for checkpoint synchronization and runtime events; remains source of truth for public run state |
| `src/modules/conversations/` | Conversation and message persistence | Extend with bounded history and resume-aware methods; remains domain owner |
| `src/modules/agents/` | Agent loading and employee creation | Expose scoped runtime contracts; remains domain owner |
| `src/modules/memory/` | Memory retrieval and persistence | Expose controlled retrieval and learning-candidate write contracts |
| `src/modules/knowledge/` | Knowledge search | Expose scoped structured retrieval contract |
| `src/modules/skills/` | Skill definitions, assignment, and lifecycle | Expose registry-ready manifests and policy data |
| `src/modules/integrations/` and `src/modules/channels/` | Integration and channel ownership/readiness | Expose readiness contracts to tools |
| `src/modules/billing/` | Usage, cost, quota, and interruption accounting | Connect to graph model/tool usage and harness enforcement |

| `src/infrastructure/langgraph/langgraph.module.ts` | Exposes LangGraph infrastructure adapters through NestJS dependency injection | Defined; not imported by the runtime module yet |
| `src/infrastructure/langgraph/langgraph-memory-checkpointer.service.ts` | In-memory LangGraph saver wrapped with serialized Jaafar state and tenant ownership checks | Defined and tested |
| `src/infrastructure/langgraph/langgraph-memory-checkpointer.service.spec.ts` | Checkpoint round-trip, tenant isolation, and deletion tests | Passing |
| `src/infrastructure/langgraph/langgraph-graph.spec.ts` | Minimal compiled and checkpointed LangGraph smoke test | Passing |
| `src/infrastructure/langgraph/langgraph-postgres-checkpointer.service.ts` | Lazy PostgreSQL saver, explicit setup, serialized Jaafar state, and scoped thread IDs | Defined and unit-tested; restart integration coverage is environment-gated |
| `src/infrastructure/langgraph/langgraph-postgres-checkpointer.service.spec.ts` | Lazy configuration and saver reuse tests | Passing |
| `src/infrastructure/langgraph/langgraph-postgres-checkpointer.integration.spec.ts` | Fresh-service-instance restore and tenant-scope isolation against PostgreSQL | Runs when `DATABASE_URL` is configured; skipped without PostgreSQL |
| `src/modules/runtime/events/runtime-event.types.ts` | Graph input event and client-compatible SSE event contracts | Defined |
| `src/modules/runtime/services/jaafar-event-normalizer.service.ts` | Normalizes lifecycle events and recursively redacts sensitive tool data | Defined and tested |
| `src/modules/runtime/services/jaafar-event-normalizer.service.spec.ts` | Token compatibility, lifecycle mapping, and redaction tests | Passing |
| `src/modules/runtime/services/runtime-event-journal.service.ts` | Best-effort bounded persistence of normalized lifecycle events in `Run.metadata` | Defined and tested |
| `src/modules/runtime/services/runtime-event-journal.service.spec.ts` | Event window retention and malformed metadata tests | Passing |
| `src/modules/runtime/services/runtime-billing-accounting.service.ts` | Resolves scoped subscriptions, records graph AI credits, and prevents duplicate run charges | Defined and tested |
| `src/modules/runtime/services/runtime-billing-accounting.service.spec.ts` | Active subscription, duplicate event, and no-subscription accounting tests | Passing |
| `src/modules/runtime/interfaces/harness.interface.ts` | Harness policy, usage, and limit contracts | Defined |
| `src/modules/runtime/services/jaafar-harness.service.ts` | Deterministic graph/tool/retry/runtime/cost/output/cancellation enforcement | Defined and tested |
| `src/modules/runtime/services/jaafar-harness.service.spec.ts` | Default configuration, limit, parallelism, and cancellation tests | Passing |
| `src/modules/runtime/interfaces/approval.interface.ts` | Approval status, requirement, and evaluation contracts | Defined |
| `src/modules/runtime/services/jaafar-approval.service.ts` | Read-only/side-effect policy, configured approval, argument-risk checks, and decision guard | Defined and tested; executor integration remains pending |
| `src/modules/runtime/services/jaafar-approval.service.spec.ts` | Approval policy and rejected-action tests | Passing |
| `src/modules/runtime/interfaces/idempotency.interface.ts` | Idempotency request, record, and status contracts | Defined |
| `src/modules/runtime/repositories/idempotency.repository.ts` | Prisma-only persistence boundary for idempotency records | Defined; database integration test remains pending |
| `src/modules/runtime/services/jaafar-idempotency.service.ts` | Deterministic keying, input hashing, replay, concurrency, and unknown-status protection | Defined and tested; executor integration remains pending |
| `src/modules/runtime/services/jaafar-idempotency.service.spec.ts` | New action, replay, concurrent, unknown, and terminal outcome tests | Passing |
| `src/modules/runtime/services/tool-registry.service.ts` | Converts validated static manifests into stable runtime tool definitions | Defined and tested; agent assignment filtering remains pending |
| `src/modules/runtime/services/tool-registry.service.spec.ts` | Definition mapping, mode delegation, lookup, and missing-tool tests | Passing |

## Added Runtime Foundation Contracts

| File | Responsibility | Status |
| --- | --- | --- |
| `src/modules/runtime/interfaces/jaafar-runtime.interface.ts` | Public start, resume, approval, rejection, cancellation, and streaming contract | Defined and active through `RuntimeController` |
| `src/modules/runtime/interfaces/jaafar-state.interface.ts` | Versioned typed graph state and checkpoint-safe references | Defined; resume integration remains pending |
| `src/modules/runtime/interfaces/tool.interface.ts` | Tool definition, call, result, and JSON value contracts | Defined; registry and executor remain pending |
| `src/modules/runtime/types/runtime-contract.types.ts` | Runtime status, intent, error, operation, usage, and event contracts | Defined with discriminated event payloads |
| `src/modules/runtime/schemas/jaafar-state.schema.ts` | State validation, serialization, deserialization, and checkpoint version rejection | Defined and tested |
| `src/modules/runtime/schemas/jaafar-state.schema.spec.ts` | State round-trip, malformed JSON, and unsupported-version tests | Passing |

## Duplicate Logic Identified

- Request routing is duplicated between `RuntimeRouterService` and planner intent classification.
- Conversation generation exists in both `ConversationRuntimeService` and the conversational branch of `RuntimeService`.
- Planning is a separate authority in `PlannerService`, then execution is separately controlled by `RuntimeService`.
- Tool execution is coupled to `RuntimeService` through `SkillEmployeeRuntimeService` and an AI SDK tool loop.
- Timeout, retry, input validation, output validation, and error normalization are concentrated in the legacy skill runtime rather than a shared tool boundary.
- Approval and resume behavior is split between `RuntimeService` and `EmployeeDesignRuntimeService`.
- Run metadata and conversation persistence are written independently by multiple runtime services.
- Memory writes occur in both general execution and employee-design confirmation paths without a shared learning policy.

## Boundary Violations And Size Risks

- `RuntimeController` imports `Run` from `@prisma/client`; the controller should depend on a runs-domain response type instead.
- `RuntimeService` is 543 lines and combines routing-adjacent planning, context loading, tool construction, execution, persistence, approval, and error handling.
- `EmployeeDesignRuntimeService` is 353 lines and combines graph-like orchestration, blueprint validation, approval, side effects, and persistence.
- `RuntimeRepository` is an empty placeholder and does not currently provide a useful persistence boundary.
- `SkillEmployeeRuntimeService` directly calls n8n using `fetch`; the target architecture requires n8n access through the integration/tool executor boundary.

## Initial File Disposition Summary

- Retain and adapt: API DTOs, safe error messaging, cache, blueprint validation/revision, model gateway, domain modules, and compatible manifest behavior.
- Migrate and then remove from the active path: `RuntimeRouterService`, `RuntimeService` as the old executor, `ConversationRuntimeService`, `EmployeeDesignRuntimeService` as a separate runtime, `SkillEmployeeRuntimeService` as the tool authority, and `PlannerService` as the planning authority.
- Delete when replacement coverage exists: empty `RuntimeRepository` and obsolete legacy tests.
- Add under target boundaries: runtime contracts, typed state, graph service, harness, tool registry/executor, run state, normalized events, and LangGraph infrastructure adapters.
