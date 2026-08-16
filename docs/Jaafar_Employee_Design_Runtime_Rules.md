# Jaafar Employee Design Runtime Rules

## 1. Purpose

Jaafar is responsible for helping the user design an AI employee before an employee is actually created.

The employee-design flow is a **stateful design workflow**, not a normal conversational response and not a direct employee-creation flow.

The core lifecycle is:

```text
User request
    ↓
Planner
    ↓
employee_design intent
    ↓
Employee Design Runtime
    ↓
Gather requirements
    ↓
Build / update blueprint
    ↓
Ready for review
    ↓
User explicitly confirms
    ↓
Create exactly one DRAFT employee
```

---

# 2. Core Safety Rule

## Jaafar must never create an employee from the normal message-processing path.

`AgentsService.create()` must **not** be called by:

- `ConversationRuntimeService`
- normal conversational response logic
- the planner
- `EmployeeDesignRuntimeService.run()`
- an LLM tool call during requirements gathering
- an LLM response that says `ready: true`

Employee creation is allowed only through the explicit confirmation boundary:

```text
EmployeeDesignRuntimeService.confirm()
```

The rule is:

```text
Normal conversation
        ↓
Design runtime
        ↓
Blueprint
        ↓
Explicit user confirmation
        ↓
AgentsService.create()
```

Never:

```text
User message
        ↓
LLM
        ↓
AgentsService.create()
```

---

# 3. Employee Design Is a Stateful Workflow

Employee design must not be implemented as:

```text
message → LLM → blueprint → employee
```

It must be implemented as a persistent state machine:

```text
Conversation
    │
    └── EmployeeDesignSession
            ├── status
            ├── blueprint
            ├── missingRequirements
            ├── approvalStatus
            ├── createdEmployeeId
            ├── sourceConversationId
            └── sourceDesignRunId
```

The structured design session is the source of truth for the design state.

Conversation history is used for conversational context, but the transcript itself must not be treated as the workflow state.

---

# 4. Design Session States

Use explicit states.

Recommended states:

```ts
type EmployeeDesignStatus =
  | "GATHERING_REQUIREMENTS"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "CREATED";
```

Recommended approval states:

```ts
type ApprovalStatus =
  | "NOT_READY"
  | "READY"
  | "APPROVED";
```

### Meaning

### `GATHERING_REQUIREMENTS`

The employee is not sufficiently defined.

Jaafar should:

- identify missing requirements
- ask only the necessary questions
- update the blueprint when the user answers
- remain in the design session

No confirmation action should be exposed.

### `READY_FOR_REVIEW`

The required employee definition is complete.

Jaafar should:

- present the completed blueprint
- allow the user to review it
- wait for explicit confirmation

No employee is created yet.

### `APPROVED`

The user explicitly approved the blueprint.

This state must only be reached through the confirmation operation.

### `CREATED`

The employee has been created successfully.

The session must store:

```text
createdEmployeeId
```

so repeated confirmation requests can be handled safely.

---

# 5. Runtime Routing

The planner may return:

```text
conversation
task_execution
employee_design
```

When the planner returns:

```text
intent = employee_design
```

the runtime must route to:

```ts
EmployeeDesignRuntimeService.run()
```

It must never fall back to ordinary conversational handling.

Recommended routing:

```ts
switch (plan.intent) {
  case "employee_design":
    return this.employeeDesignRuntime.run(context);

  case "task_execution":
    return this.taskExecutionRuntime.run(context);

  case "conversation":
  default:
    return this.respondConversationally(context);
}
```

The frontend should not be responsible for deciding whether a request is an employee-design request.

The planner/runtime should own that decision.

The frontend may display the current mode/state, but it should not bypass the planner's intent detection.

---

# 6. Conversation Persistence

Every employee-design turn must persist both sides of the conversation.

For every design turn:

```text
Load previous messages
        ↓
Load design session
        ↓
Process current user message
        ↓
Update blueprint
        ↓
Generate Jaafar response
        ↓
Persist user message
        ↓
Persist assistant message
        ↓
Persist updated design session
```

The current user message must not exist only in memory.

The assistant response must not exist only in memory.

This guarantees that the next design turn has:

- the original request
- previous user answers
- previous Jaafar questions
- current blueprint
- current missing requirements
- current design status

The same `conversationId` must be preserved throughout the employee-design session.

---

# 7. First Employee Request Rule

The first employee-design message starts a **design session**.

It does not create an employee.

Example:

```text
User:
"I want an HR employee."
```

Expected behavior:

```text
Jaafar:
"What should this employee handle?"
```

Not:

```text
Create HR employee
```

The first request should normally result in:

```text
designStatus = GATHERING_REQUIREMENTS
approvalStatus = NOT_READY
```

unless the user actually provided enough information to build a complete employee definition.

Even when enough information is provided in one message, the employee must still not be created automatically.

The user must explicitly review and confirm.

---

# 8. LLM Readiness Is Advisory Only

The LLM must never be the final authority on whether an employee is ready.

The model may return:

```json
{
  "ready": true
}
```

but the backend must validate the blueprint independently.

Never do:

```ts
if (blueprint.ready) {
  status = "READY_FOR_REVIEW";
}
```

Instead:

```ts
const validation = validateEmployeeBlueprint(blueprint);

if (!validation.valid) {
  status = "GATHERING_REQUIREMENTS";
  missingRequirements = validation.missing;
} else {
  status = "READY_FOR_REVIEW";
}
```

The rule is:

> The LLM can suggest readiness. The application decides readiness.

This protects the system from hallucinated or premature readiness.

---

# 9. Minimum Employee Blueprint

The backend should validate the essential employee definition.

Required fields should normally include:

```text
name
role
department
description
instructions
responsibilities
goals
boundaries / permissions
```

At least:

```text
1 responsibility
1 goal
```

must exist.

A blueprint is not ready if these fields are empty or meaningless.

---

# 10. Optional Employee Configuration

The following should not automatically be treated as universally required:

```text
Knowledge
Channels
Integrations
Skills
Memory
```

These depend on the employee being designed.

For example, an employee can exist without a channel being configured yet.

Channels and integrations are deployment/configuration concerns unless the specific employee requires them.

If a particular employee requires an integration or channel, the design session should identify it as a requirement.

Otherwise it can remain:

```text
not configured
```

or:

```text
explicitly unnecessary
```

---

# 11. Skills Are Workflows

In Woops:

```text
Skill = Workflow
```

An employee may have multiple skills.

Example:

```text
HR Employee
├── Recruitment
├── Employee Onboarding
├── Leave Management
└── HR FAQ
```

The employee blueprint should be capable of describing required skills.

Example:

```json
{
  "skills": [
    {
      "name": "Employee Onboarding",
      "description": "...",
      "workflow": {}
    }
  ]
}
```

However, Jaafar must not force the user to fully define every workflow during the first message.

The design session should first understand:

- what the employee does
- what responsibilities it owns
- what outcomes it should produce
- what skills/workflows are needed

Detailed workflow construction can happen as part of the subsequent design process.

---

# 12. Missing Requirements

When required information is missing:

```text
designStatus = GATHERING_REQUIREMENTS
approvalStatus = NOT_READY
```

Jaafar should ask for the missing information.

The response should focus on the missing requirements instead of pretending the employee is complete.

Example:

```text
User:
"I want a sales employee."

Jaafar:
"What should the sales employee be responsible for?"
```

After the answer:

```text
User:
"Follow up with leads and qualify them."

Jaafar:
"Which channels should it use for lead communication?"
```

The session continues until the blueprint passes backend validation.

---

# 13. Do Not Ask Unnecessary Questions

Jaafar should not turn employee design into an endless questionnaire.

Only ask questions that materially affect:

- employee behavior
- responsibilities
- goals
- boundaries
- tools
- workflows
- knowledge
- required integrations
- required channels

If a field can safely remain configurable later, do not block the design on it.

The goal is:

```text
Minimum information required for a safe, useful employee
```

not:

```text
Collect every possible configuration before continuing
```

---

# 14. Employee Blueprint Validation

Create a dedicated validation layer.

Example:

```ts
interface EmployeeBlueprintValidation {
  valid: boolean;
  missing: string[];
}
```

The validator should check:

```text
name
role
department
description
instructions
responsibilities
goals
boundaries
```

It should also validate that values are meaningful, not merely non-empty strings.

Bad:

```json
{
  "goals": ["do work"]
}
```

Better:

```json
{
  "goals": [
    "Qualify incoming leads and route high-intent prospects to the sales team."
  ]
}
```

The validator should be deterministic and independent from the LLM.

---

# 15. Review Boundary

Once validation succeeds:

```text
GATHERING_REQUIREMENTS
        ↓
READY_FOR_REVIEW
```

Jaafar should present the user with the blueprint.

Example structure:

```text
Employee
- Name
- Role
- Department
- Description

Responsibilities
- ...

Goals
- ...

Skills
- ...

Knowledge
- ...

Tools / Integrations
- ...

Channels
- ...

Boundaries
- ...
```

The user must explicitly confirm.

Valid confirmation examples:

```text
Yes, create it.
Confirm.
Create the employee.
Looks good, create it.
```

Do not interpret ambiguous messages as confirmation.

---

# 16. Confirmation Is a Separate Operation

Confirmation must not be implemented as another normal chat response.

It should be a dedicated operation:

```ts
confirm(designRunId)
```

The confirmation flow:

```text
Load design session
        ↓
Verify ownership
        ↓
Verify organization
        ↓
Verify employee-design run
        ↓
Verify status
        ↓
Validate blueprint
        ↓
Atomically approve
        ↓
Create employee
        ↓
Store createdEmployeeId
        ↓
Mark session CREATED
```

---

# 17. Confirmation Must Reject Incomplete Designs

`confirm()` must independently validate the blueprint.

Never assume that the design runtime already validated it.

Example:

```ts
const validation = validateEmployeeBlueprint(session.blueprint);

if (!validation.valid) {
  throw new EmployeeDesignNotReadyError(validation.missing);
}
```

This provides defense in depth.

---

# 18. Ownership and Authorization

Before confirmation, verify:

```text
designRun.userId
designRun.organizationId
authenticated user
authenticated organization
```

The authenticated user must own or have permission to confirm the design.

A user must never be able to confirm another user's employee-design run.

---

# 19. Idempotent Confirmation

Repeated confirmation must never create multiple employees.

Bad:

```text
POST confirm
    ↓
create employee

POST confirm
    ↓
create another employee
```

Correct:

```text
POST confirm
    ↓
create employee
    ↓
createdEmployeeId = X

POST confirm again
    ↓
return employee X
```

The design run should contain:

```text
createdEmployeeId
```

and creation must be protected against concurrent confirmation requests.

---

# 20. Concurrency Protection

A simple in-memory check is not sufficient.

This is unsafe:

```ts
if (!run.createdEmployeeId) {
  createEmployee();
}
```

Two concurrent requests can both see:

```text
createdEmployeeId = null
```

and both create an employee.

Use a durable atomic persistence mechanism.

Recommended approach:

```text
READY_FOR_REVIEW
        ↓
atomic transition
        ↓
APPROVED
        ↓
create employee
        ↓
CREATED
```

The transition must be conditional on the current state.

The database should enforce the concurrency boundary.

---

# 21. Employee Creation Result

The created employee should initially be:

```text
status = DRAFT
```

unless the product explicitly defines another lifecycle.

The design session should retain:

```text
createdEmployeeId
```

and the source metadata:

```text
sourceConversationId
sourceDesignRunId
```

This allows the employee to be traced back to its design process.

---

# 22. Learning Persistence

After the employee draft is created, Jaafar may derive structured learning outcomes from the design conversation.

Examples:

```text
Confirmed responsibilities
Confirmed business rules
Confirmed employee goals
Confirmed boundaries
Confirmed preferences
Confirmed workflow requirements
```

However:

> Never store the raw conversation transcript as Knowledge.

The transcript is conversational history.

Knowledge must be structured and intentional.

---

# 23. Knowledge Requires Approval

Information extracted from the design conversation should not automatically become permanent employee Knowledge.

Use:

```text
Design conversation
        ↓
Structured learning candidate
        ↓
Review / approval
        ↓
Employee Knowledge
```

Only confirmed facts should become durable employee Knowledge.

---

# 24. Separation of Responsibilities

## Planner

Responsible for:

```text
Intent classification
High-level routing
```

The planner does not create employees.

---

## Runtime Service

Responsible for:

```text
Routing execution to the correct runtime
```

It does not create employees.

---

## Employee Design Runtime

Responsible for:

```text
Managing the design session
Updating the blueprint
Identifying missing requirements
Generating clarification questions
Generating the review blueprint
```

It does not create employees during `run()`.

---

## Employee Design Confirmation

Responsible for:

```text
Validation
Authorization
Explicit approval
Idempotent employee creation
```

This is the only place that may call:

```ts
AgentsService.create()
```

---

## AgentsService

Responsible for:

```text
Creating the actual employee entity
```

It should not decide whether the user intended to create an employee.

---

# 25. Recommended Data Model

A design run/session should contain enough durable information to recover the state.

Example:

```text
EmployeeDesignRun
-------------------------
id
conversationId
organizationId
userId

status
approvalStatus

blueprint
missingRequirements

createdEmployeeId

sourceConversationId
sourceDesignRunId

createdAt
updatedAt
approvedAt
completedAt
```

The exact schema may differ, but the concepts must remain.

---

# 26. Recovery Rule

The design process must survive:

- server restart
- request retry
- user returning later
- multiple conversation turns
- failed LLM request
- failed employee creation
- duplicate confirmation request

The state must therefore be persisted.

Do not keep the employee-design state only inside memory or a request object.

---

# 27. Error Handling

If blueprint generation fails:

```text
Keep previous valid blueprint
Keep previous design status
Do not create employee
```

If confirmation fails:

```text
Do not mark employee as created
Do not lose the design session
Allow safe retry
```

If employee creation succeeds but the response fails:

```text
createdEmployeeId must still exist
```

so the next confirmation request does not create another employee.

---

# 28. Tests Required

## First message

Test:

```text
First employee request
        ↓
clarification questions
        ↓
no employee created
```

Assert:

```text
AgentsService.create() was not called
```

---

## Same conversation

Test:

```text
Turn 1
    ↓
Turn 2
```

Assert that Turn 2 has access to:

```text
Turn 1 user message
Turn 1 assistant response
design session
blueprint
```

---

## Message persistence

Assert that every employee-design turn persists:

```text
user message
assistant response
```

---

## Intent routing

Planner:

```json
{
  "intent": "employee_design"
}
```

must reach:

```text
EmployeeDesignRuntimeService
```

and not:

```text
respondConversationally()
```

---

## LLM readiness protection

LLM:

```json
{
  "ready": true
}
```

with missing required fields must result in:

```text
GATHERING_REQUIREMENTS
NOT_READY
```

---

## Confirmation rejection

Incomplete blueprint:

```text
confirm()
```

must fail.

No employee should be created.

---

## Successful confirmation

Complete blueprint:

```text
READY_FOR_REVIEW
        ↓
explicit confirmation
        ↓
one DRAFT employee
```

---

## Repeated confirmation

Two confirmation requests must result in:

```text
one employee
```

not two.

---

## Concurrent confirmation

Simultaneous confirmation requests must also result in:

```text
one employee
```

---

# 29. End-to-End Acceptance Test

The complete flow must work:

```text
1. User asks Jaafar to create an employee
        ↓
2. Planner detects employee_design
        ↓
3. Employee Design Runtime starts
        ↓
4. Design session is persisted
        ↓
5. Jaafar asks missing questions
        ↓
6. User answers
        ↓
7. Same conversationId continues the session
        ↓
8. Blueprint is progressively updated
        ↓
9. Backend validates required fields
        ↓
10. Blueprint becomes READY_FOR_REVIEW
        ↓
11. Jaafar shows the blueprint
        ↓
12. User explicitly confirms
        ↓
13. Confirmation validates ownership and readiness
        ↓
14. Atomic confirmation prevents duplicates
        ↓
15. AgentsService.create() creates exactly one DRAFT employee
        ↓
16. createdEmployeeId is persisted
        ↓
17. Repeated confirmation returns the existing employee
```

---

# 30. Architectural Invariants

These rules must always remain true.

### Invariant 1

```text
No explicit confirmation
        =
No employee creation
```

### Invariant 2

```text
LLM ready=true
        ≠
Backend ready
```

### Invariant 3

```text
EmployeeDesignRuntime.run()
        ≠
Employee creation
```

### Invariant 4

```text
Conversation history
        ≠
Design state
```

Conversation history provides context.

The design session provides structured state.

### Invariant 5

```text
Frontend mode
        ≠
Source of truth for routing
```

The planner/runtime owns routing.

### Invariant 6

```text
One design run
        →
At most one employee
```

### Invariant 7

```text
Raw transcript
        ≠
Employee Knowledge
```

### Invariant 8

```text
Skills = Workflows
```

Employee design must be compatible with Woops' skill/workflow model.

---

# 31. Main Files

The implementation will likely involve:

```text
src/modules/runtime/services/runtime.service.ts

src/modules/runtime/employee-design/
  employee-design-runtime.service.ts
  employee-design-runtime.service.spec.ts

src/modules/runtime/services/
  runtime.service.spec.ts

src/modules/runtime/
  runtime-router.service.spec.ts

src/infrastructure/prompts/modules/
  jaafar.prompt.ts

prisma/schema.prisma
```

Additional repositories/services may be introduced if required by the persistent design-session implementation.

---

# 32. Final Principle

Jaafar should behave like a **designer first and a creator second**.

The normal interaction is:

```text
Understand
    ↓
Ask
    ↓
Understand more
    ↓
Build blueprint
    ↓
Validate
    ↓
Show
    ↓
Wait for explicit approval
    ↓
Create
```

Never:

```text
Understand
    ↓
Guess
    ↓
Create
```

The system should be designed so that even if the LLM makes a mistake, the application cannot accidentally create an employee.
