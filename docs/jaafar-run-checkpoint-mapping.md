# Jaafar Run And Checkpoint Mapping

Status: Defined
Date: 2026-08-11
Related plan: `docs/jaafar-langgraph-runtime-migration-plan.md`

## Ownership

`Run` remains the public platform record. The LangGraph checkpoint remains the durable execution record. Neither record replaces the other.

### Prisma `Run` Source Of Truth

The following fields remain authoritative in `Run` and are safe for API retrieval, access checks, billing, and analytics:

| Run field | Rule |
| --- | --- |
| `id` | Public run identifier and checkpoint scope identifier |
| `agentId` | Agent ownership reference |
| `conversationId` | Conversation ownership reference |
| `userId` | Personal tenant scope |
| `organizationId` | Organization tenant scope |
| `status` | Public lifecycle status |
| `plan` | Validated plan summary, not the complete graph state |
| `result` | Final user-facing response after graph completion is persisted |
| `error` | Safe error summary and normalized code reference |
| `metadata` | Bounded compatibility metadata and summary fields only |
| `startedAt`, `completedAt`, `durationMs` | Public timing summary |
| `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCost` | Usage and billing summary |
| `version` | Existing optimistic-concurrency/version field; must protect side-effect claims |

### Checkpoint-Only State

The checkpoint owns resumable execution details that should not be treated as business truth or exposed as an unrestricted API document:

- Graph node position and pending transition.
- Full typed `JaafarState` required to resume.
- Bounded conversation context used by the current graph step.
- Understanding and clarification details.
- Registered tool references and validated tool calls.
- Tool results and retry counters required for safe recovery.
- Approval interrupt payload and resume decision state.
- Reflection and learning candidates before policy filtering.
- Checkpoint schema version and graph execution identifiers.

Credentials, OAuth tokens, provider secrets, raw authorization material, and unrestricted external payloads are never stored in checkpoints.

## Synchronization Rules

1. Create `Run` before starting graph execution and use its ID as the checkpoint thread ID.
2. Persist a checkpoint after every transition that can wait, retry, resume, or produce a side effect.
3. Update public `Run.status` only after the corresponding checkpoint write succeeds.
4. Persist `Run.plan` only after plan validation succeeds; store only a bounded plan summary.
5. Persist usage and cost after each model call when possible, and reconcile the final total before completion.
6. Persist `Run.result` and transition to `COMPLETED` only after the final graph state and final response have been checkpointed.
7. A `WAITING` run must have a valid checkpoint containing the interrupt reason and enough state to resume.
8. A `CANCELLED` run must be terminal in the public record and its checkpoint must be marked non-resumable before the cancellation response returns.
9. All status and side-effect claim updates must be idempotent and use the existing `Run.version` concurrency protection where applicable.

## Failure Rules

### Checkpoint Write Fails Before Run Update

- Do not advance the public run status.
- Keep the run in its last safe status when possible.
- Return or persist `CHECKPOINT_FAILURE` without exposing state contents.
- Do not claim that an approval, tool call, or completion is resumable until a checkpoint is successfully written.

### Run Update Fails After Checkpoint Write

- Treat the checkpoint as the execution record, but do not report completion from the API.
- Retry the bounded `Run` synchronization using the same run ID and idempotency key.
- If reconciliation cannot complete, classify the run as a recoverable synchronization failure and alert through runtime observability.
- A reconciliation worker may repair the public summary from the checkpoint; it must never replay a completed side effect.

### Run Exists But Checkpoint Is Missing

- For `CREATED` runs with no graph start, fail safely and require a new run or explicit retry.
- For `WAITING` or `EXECUTING` runs, classify as `CHECKPOINT_FAILURE`; never reconstruct state from incomplete `Run.metadata`.
- For `COMPLETED`, `FAILED`, or `CANCELLED` runs, the missing checkpoint does not permit execution or resume.

### Checkpoint Is Corrupt Or Incompatible

- Reject deserialization explicitly.
- Do not attempt to reinterpret an incompatible state with the current graph.
- Mark the run as failed or leave it waiting for an operator-controlled migration according to the checkpoint version policy.

## In-Flight Migration Policy

Old runtime runs are not resumed by the new graph. During rollout, old waiting runs are drained on the old implementation or explicitly cancelled with a request to restart. The new graph only accepts checkpoints with the declared `JAAFAR_STATE_SCHEMA_VERSION`.

## PostgreSQL Checkpointer Operations

- The checkpointer uses the existing `DATABASE_URL` configuration.
- The LangGraph checkpoint tables are managed in the `langgraph_checkpoints` PostgreSQL schema.
- Checkpointer creation is lazy and does not connect during NestJS provider construction.
- Call `LangGraphPostgresCheckpointerService.setup()` during an explicit deployment or migration step before enabling graph traffic.
- Do not call `setup()` on every request or hide checkpoint migrations inside graph execution.
- Checkpoint thread IDs include organization scope, user scope, and run ID.

## Side-Effect Idempotency

- Side-effect records are stored in the PostgreSQL `runtime_idempotency_keys` table.
- The unique key is derived from run ID, tool identity, and logical action.
- Input is hashed and compared before returning a prior result.
- `STARTED` records block concurrent execution.
- `COMPLETED` records return the prior result without replaying the side effect.
- `UNKNOWN` records block automatic replay until an explicit recovery decision is made.
