# Jaafar Employee Creation Bug Report

Status: Confirmed

Date investigated: 2026-08-10

Affected flow: Jaafar employee design and conversation startup

## 1. Executive Summary

The observed employee-creation behavior is caused by two separate flows being mixed together:

1. The client creates a placeholder Agent before starting the Jaafar conversation.
2. Jaafar then runs as a normal conversation against that placeholder Agent and claims that the employee was created, even though no CFO employee was created from the collected blueprint.

The placeholder Agent is created before the first runtime run and before the first user message is persisted. Its values are:

```text
name: New Employee
description: hi jaafar we need to create my employee
instructions: hi jaafar we need to create my employee
model: gpt-4o
status: DRAFT
```

This is not the intended employee-design lifecycle.

The intended lifecycle is:

```text
User request
    -> Use the existing Jaafar Agent
    -> Planner detects employee_design
    -> Employee Design Runtime gathers requirements
    -> Blueprint is updated across turns
    -> Blueprint is displayed for review
    -> User explicitly accepts the exact blueprint
    -> One DRAFT employee is created
```

The following flow must never happen:

```text
First user message
    -> POST /agents
    -> New Employee placeholder is created
    -> Normal conversation starts
    -> Jaafar claims the employee was created
```

## 2. Impact

The bug causes the following incorrect behavior:

- An Agent is created from the first user message before requirements are collected.
- The placeholder name `New Employee` is stored instead of a business-derived employee name.
- The first prompt is copied into the Agent description and instructions.
- `gpt-4o` is stored as Agent metadata even though the runtime model is selected elsewhere.
- The runs are recorded as normal conversation runs instead of employee-design runs.
- The collected CFO requirements are not persisted as an employee blueprint.
- Jaafar claims that an employee was created when the database contains no corresponding CFO employee.
- The user cannot reliably distinguish a draft design from a created employee.

## 3. Live Database Evidence

The database was inspected through the local PostgreSQL instance on port `5432`. Port `51212` was Prisma Studio, not PostgreSQL.

### 3.1 Agent Record

The database contained one Agent record:

```text
id: aa27bc7f-d53b-4956-b5fd-f4994816d9f5
name: New Employee
description: hi jaafar we need to create my employee
instructions: hi jaafar we need to create my employee
personality: null
model: gpt-4o
status: DRAFT
userId: 9ae38587-6780-4a21-86cb-3f9bf62555fe
organizationId: null
createdAt: 2026-08-09T21:24:18.568Z
updatedAt: 2026-08-09T21:24:18.568Z
```

The Agent name does not match the CFO design. The description and instructions exactly match the first user message.

This proves that the row is a placeholder created from the initial request rather than an employee generated from the completed CFO blueprint.

### 3.2 Creation Timeline

The relevant timestamps are:

```text
Agent created:          2026-08-09T21:24:18.568Z
First run created:      2026-08-09T21:24:18.624Z
First user message:    2026-08-09T21:24:41.759Z
```

The Agent was created 56 milliseconds before the first runtime run and more than 23 seconds before the first user message was persisted.

Therefore, the Agent was created before Jaafar processed the first conversation message.

### 3.3 Run Records

There were eight runs for the conversation. Every run had:

```text
runtimeMode: conversation
intent: conversation
transport: sse
status: COMPLETED
```

The runs did not contain:

```text
runtimeMode: employee_design
blueprint
approvalStatus
createdAgentId
```

There was no employee-design run and no evidence that the dedicated employee confirmation operation was used.

### 3.4 Conversation Record

```text
conversationId: 394a1714-8073-4830-8639-cde2a0fea963
title: hi jaafar we need to create my employee
agentId: aa27bc7f-d53b-4956-b5fd-f4994816d9f5
userId: 9ae38587-6780-4a21-86cb-3f9bf62555fe
organizationId: null
createdAt: 2026-08-09T21:24:18.592Z
updatedAt: 2026-08-09T21:31:59.308Z
```

The conversation uses the placeholder Agent created before the first run.

## 4. Conversation Evidence

The conversation collected substantial CFO requirements over multiple turns.

### Initial Request

```text
hi jaafar we need to create my employee
```

Jaafar asked for the employee role, responsibilities, tools, permissions, and personality.

### Role And Channel

```text
we must be my cfo ... he can access to whatsapp and i will send him everything spends in the company and we will manage everyhing
```

### Business Requirements

```text
yeah invoices and transations
yeah it montly tracker
USD
```

The actual stored message had the user responses for invoices, transactions, monthly tracking, and USD currency.

### Reports, Categories, And Alerts

```text
everything for the company ,, yeah sure i wanna reports ,, also yes ,,, no thanks i dont wanna anything
```

Jaafar summarized the intended CFO responsibilities, monthly reports, and budget alerts.

### Blueprint Review

Jaafar displayed a CFO blueprint including:

- CFO role.
- WhatsApp channel.
- USD currency.
- Invoice and transaction logging.
- Expense categorization.
- Monthly tracking.
- Monthly reporting.
- Budget alerts.
- Expense database.
- Reporting engine.
- Boundaries against payments and bank access.

The user replied:

```text
ok process
```

### Additional Business Details

```text
dropgift the company name ,,, and we are in egy ,,, and the budget alert is $10k
```

Jaafar then recorded:

- Company: Dropgift.
- Location: Egypt.
- Currency: USD.
- Budget alert: $10,000 per month.
- Standard expense categories.

### Missing Channel Configuration

The user finally said:

```text
i dont have WA number now i will set it later so start build the agent and we will setup the channel later
```

Jaafar responded:

```text
Understood! I'll build your CFO employee now.

Building Dropgift's CFO Employee...

Employee Profile: Created
```

However, the database still contained only the original `New Employee` row. There was no Agent named CFO, Dropgift CFO, or similar.

This response is a false completion claim.

## 5. Exact Code Creation Paths

There are two relevant `AgentsService.create()` paths.

### 5.1 Direct Agent API Path

File:

```text
src/modules/agents/controllers/agents.controller.ts:25-32
```

Endpoint:

```text
POST /agents
```

Implementation:

```ts
@Post()
async create(@Body() dto: CreateAgentDto, @CurrentUser() user: AgentUser) {
  const parsed = createAgentSchema.parse(dto);

  return this.agentsService.create({
    ...parsed,
    userId: user.id,
    organizationId:
      user.activeContext === 'organization' ? user.organizationId : undefined,
  });
}
```

This endpoint allows a client to create a DRAFT Agent before Jaafar gathers any requirements.

The database timing and values strongly indicate that the frontend called this endpoint when initializing the employee conversation.

### 5.2 Jaafar Confirmation Path

The intended Jaafar creation boundary is:

```text
src/modules/runtime/employee-design/employee-design-runtime.service.ts:267
```

```ts
agent = await this.agentsService.create({
  name: blueprint.name,
  description: blueprint.description,
  instructions: blueprint.instructions,
  status: 'DRAFT',
  model: 'gpt-4o',
  organizationId: run.organizationId ?? undefined,
});
```

This path is reached from:

```text
POST /runs/:id/confirm
    -> RuntimeController.confirm()
    -> RuntimeRouterService.confirmEmployeeDesign()
    -> EmployeeDesignRuntimeService.confirm()
    -> AgentsService.create()
```

The live database contains no `employee_design` run, no `createdAgentId`, and no blueprint metadata. The recorded incident therefore did not use this intended path.

## 6. Runtime Routing Evidence

The affected runs were all normal conversation runs:

```text
runtimeMode: conversation
intent: conversation
```

They were not routed through the employee-design runtime.

The intended routing code is:

```text
src/modules/runtime/runtime-router.service.ts:41-65
```

```ts
const plan = await this.plannerService.createPlan(...);

if (plan.intent === 'employee_design') {
  return this.employeeDesignRuntime.run({
    ...request,
    mode: RuntimeMode.EMPLOYEE_DESIGN,
  });
}

return this.conversationRuntime.run(request);
```

The recorded data indicates that the affected application instance was using the old conversation flow, the client explicitly selected conversation mode, or the running image had not yet incorporated this routing change.

The frontend must not create an Agent and then use it as the target for the first Jaafar design conversation.

## 7. False Completion Claim

The normal conversation response claimed:

```text
Employee Profile: Created
```

The database contradicted this claim:

- The only Agent was `New Employee`.
- Its description and instructions were the first prompt.
- There was no CFO Agent.
- There was no `createdAgentId` in any run.
- There was no employee-design confirmation run.

The platform prompt requires Jaafar to never claim that an employee, integration, or action was deployed unless the runtime confirms it.

The normal conversation path must not generate completion language such as:

- Employee created.
- Profile created.
- Employee ready.
- Employee activated.
- WhatsApp connected.
- Employee is live.

unless the runtime returns a confirmed creation result with a persisted `createdAgentId`.

## 8. Model Metadata Problem

The Agent schema currently defines:

```prisma
model String
```

The DTO also supplies a default:

```ts
model: z.string().default('gpt-4o')
```

The Jaafar creation path hard-codes:

```ts
model: 'gpt-4o'
```

The actual LLM runtime selects models using execution mode and configuration:

```text
low    -> LLM_LOW_MODEL
medium -> LLM_MEDIUM_MODEL
high   -> LLM_HIGH_MODEL
```

Therefore, `Agent.model` is not the authoritative runtime configuration. It is currently stale or misleading metadata.

The model value should not be required employee business data. The effective provider and model should be recorded in run execution metadata, for example:

```json
{
  "execution": {
    "provider": "openai",
    "model": "openai:gpt-4o",
    "mode": "medium"
  }
}
```

The source tree contains `gpt-4o` and `gpt-4o-mini`, but no `gpt-o4`. If `gpt-o4` is found in a database record, it originated from external input or an older implementation.

## 9. Root Cause

### Primary Root Cause

The client creates a placeholder Agent before starting the Jaafar employee-design conversation.

Likely flow:

```text
POST /agents
{
  "name": "New Employee",
  "description": "hi jaafar we need to create my employee",
  "instructions": "hi jaafar we need to create my employee"
}
    -> Agent created as DRAFT
    -> Conversation created with that Agent ID
    -> POST /runs starts normal conversation
```

The user's first message is incorrectly treated as Agent entity data.

### Secondary Root Cause

The affected request used the normal conversation path rather than a structured employee-design run. The model therefore produced conversational setup text without a persisted blueprint state machine.

### Tertiary Root Cause

The normal conversation prompt permitted Jaafar to produce claims about building and creating the employee without a runtime creation result.

### Metadata Root Cause

The Agent model is required and defaults to `gpt-4o`, although actual model selection is controlled by LLM execution configuration.

## 10. Required Remediation

### 10.1 Frontend Startup Flow

Remove the initial `POST /agents` call from Jaafar employee-design startup.

The frontend should:

1. Use the existing Jaafar Agent ID.
2. Create or reuse a conversation with Jaafar.
3. Submit user messages through `POST /runs`.
4. Allow the planner/runtime to detect `employee_design`.
5. Display clarification questions or the blueprint returned by the design runtime.
6. Wait for an explicit user approval action.
7. Call `POST /runs/:id/confirm` only after the user approves the displayed blueprint.

The frontend must not create an Agent merely to start a conversation.

### 10.2 Backend Creation Boundary

Employee creation must only happen through the employee-design confirmation operation.

The invariant is:

```text
No explicit approval = No employee creation
```

The direct `/agents` endpoint should be reserved for an intentional administrative or user-created Agent flow. It must not be used as the initialization endpoint for Jaafar design sessions.

### 10.3 Explicit Confirmation Payload

The confirmation endpoint currently accepts a bare POST. It should require a validated payload such as:

```json
{
  "confirm": true,
  "blueprintRevision": "sha256:..."
}
```

The backend must reject:

```json
{}
```

and:

```json
{
  "confirm": false
}
```

The confirmation must match the exact blueprint displayed to the user.

### 10.4 Blueprint Revision

When a blueprint becomes ready for review:

1. Canonicalize the blueprint.
2. Generate a content hash or revision.
3. Store the revision on the design run.
4. Return the revision to the client.
5. Require the revision in the confirmation request.
6. Reject confirmation if the blueprint has changed.

### 10.5 Model Metadata

The system should choose one authoritative model architecture. The recommended approach is effort-based runtime selection:

- Make `Agent.model` optional or informational.
- Remove the default `gpt-4o` from employee creation.
- Do not hard-code a model in `EmployeeDesignRuntimeService.confirm()`.
- Store the effective provider/model in run execution metadata.
- Validate any externally supplied model value if the field remains exposed.

### 10.6 Name Validation

The employee name should come from the confirmed blueprint, not from the initial chat creation request.

Backend validation should:

- Reject placeholder names such as `New Employee`.
- Reject empty or generic names such as `Assistant` where the role is known.
- Define whether names must be unique within an organization.
- Enforce the chosen uniqueness policy in the service and database.

## 11. Acceptance Tests

The following tests must pass before the bug is considered fixed:

1. Starting a Jaafar design conversation does not call `POST /agents`.
2. The first Jaafar message creates no employee.
3. The first design turn creates only a conversation and design run.
4. Follow-up answers update the same design session.
5. The current user and assistant design messages are persisted.
6. A complete blueprint is displayed before employee creation.
7. No employee exists while the blueprint is waiting for approval.
8. A bare `/runs/:id/confirm` request is rejected.
9. Confirmation requires `confirm: true`.
10. Confirmation requires the current blueprint revision/hash.
11. A stale blueprint revision is rejected.
12. Only the confirmation boundary can create the employee from a blueprint.
13. The created employee uses the confirmed blueprint name.
14. The created employee is `DRAFT`.
15. The creation path does not hard-code a model as employee business data.
16. The effective LLM model is recorded in run execution metadata.
17. Normal conversation cannot claim employee creation without runtime confirmation.
18. Concurrent confirmation creates at most one employee.
19. Direct Agent creation cannot be triggered by the first Jaafar message.
20. The database contains a design run before any created employee.

## 12. Diagnostic Queries

These read-only queries can be used to investigate future incidents:

```sql
SELECT
  id,
  name,
  description,
  instructions,
  model,
  status,
  "userId",
  "organizationId",
  "createdAt"
FROM agents
ORDER BY "createdAt" DESC;
```

```sql
SELECT
  id,
  "agentId",
  "conversationId",
  "userId",
  "organizationId",
  status,
  metadata,
  "createdAt",
  "completedAt"
FROM runs
ORDER BY "createdAt" DESC;
```

```sql
SELECT
  id,
  title,
  "agentId",
  "userId",
  "organizationId",
  metadata,
  "createdAt",
  "updatedAt"
FROM conversations
ORDER BY "createdAt" DESC;
```

```sql
SELECT
  id,
  "conversationId",
  role,
  content,
  metadata,
  "createdAt"
FROM messages
ORDER BY "createdAt" DESC;
```

The following correlation proves whether a placeholder was created before Jaafar processed the message:

```text
agents.createdAt
< runs.createdAt
< messages.createdAt
```

## 13. Final Invariants

The following invariants must remain true:

```text
First Jaafar message != employee creation
```

```text
Conversation startup != POST /agents
```

```text
No explicit approval = no employee creation
```

```text
LLM response claiming creation != confirmed employee creation
```

```text
createdAgentId persisted = only reliable creation confirmation
```

```text
Raw conversation context != employee entity state
```

Jaafar must behave as a designer first and a creator only after explicit, backend-verified approval.
