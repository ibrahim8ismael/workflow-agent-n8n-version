# Jaafar Runtime Operations

## Checkpoint Setup

Before enabling graph traffic, run the LangGraph PostgreSQL checkpointer setup against the
production `DATABASE_URL`. The setup is an explicit deployment operation and must not run per request.

Checkpoint setup uses the checkpointer package's versioned migrations. Deployments must run
`npm run runtime:checkpoint:setup` before accepting graph traffic and must treat a setup failure as a
deployment failure.

Production graph services reject in-memory checkpointing. A missing or incompatible checkpoint is a
terminal runtime failure and must never be reconstructed from `Run.metadata`.

## Health Signals

Use the bounded `Run.metadata.runtimeEvents` journal and application logs to inspect:

- `run.started`, `run.waiting`, `run.completed`, `run.failed`, and `run.cancelled` counts
- Graph node duration and tool duration
- Tool failure and retry rates
- Approval wait count and resume outcomes
- Model usage, estimated cost, and billing event status

Runtime events are capped at 100 entries per run and contain normalized, redacted payloads only.

Task-graph stream exceptions transition the associated run to `FAILED` before the terminal failure
event is emitted. Once a stream has emitted a run ID, client disconnect cleanup cancels that run.

## Old Run Drain

Old runtime runs must be drained before deleting compatibility services. Waiting old runs may either
complete on the old implementation or be explicitly cancelled with a restart instruction. They must
not be resumed by the LangGraph runtime.

## Incident Controls

- Set `JAAFAR_RUNTIME_KILL_SWITCH=true` to stop new graph runs.
- Set `JAAFAR_RUNTIME_INTERNAL_ONLY=true` to limit graph traffic to requests with an authenticated user scope.
- Set `JAAFAR_RUNTIME_ENABLED=false` to disable graph runtime activation.
- Set `N8N_WORKFLOW_MAP` to map registered tool slugs to n8n workflow IDs and required integration names.

After an incident, reconcile failed, waiting, cancelled, and completed runs against billing events
before clearing the kill switch.
