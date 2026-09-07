# Jaafar V2 — Full Engineering TODO

> الهدف: تحويل Jaafar من LLM يحاول إنشاء n8n workflows إلى **Production-grade Business Automation Agent** يستطيع فهم الطلب، التخطيط، البناء، التنفيذ، التحقق، إصلاح الأخطاء، والتعلم من حالات الفشل.

---

# 0. Architecture Foundation

## 0.1 Define Jaafar's execution architecture

* [ ] Define the complete Jaafar lifecycle:

  * User request
  * Context loading
  * Intent understanding
  * Business analysis
  * Automation planning
  * Workflow building
  * Static validation
  * Workflow execution
  * Runtime validation
  * Self-repair
  * Completion
  * Failure escalation

* [ ] Document responsibilities for every stage.

* [ ] Define which stage can call tools.

* [ ] Define which stage can modify the workflow.

* [ ] Define which stage can communicate completion.

* [ ] Prevent stages from bypassing required validation.

### Done when

* There is a documented architecture.
* Every Jaafar action belongs to a defined stage.
* Jaafar cannot report success before validation.

---

# 1. Agent Run State

## 1.1 Create AgentRun

Create a persistent entity representing one Jaafar task.

Suggested structure:

```text
AgentRun
├── id
├── organizationId
├── userId
├── conversationId
├── originalRequest
├── status
├── currentPhase
├── businessContext
├── requirements
├── assumptions
├── constraints
├── availableIntegrations
├── automationPlan
├── workflowId
├── workflowVersion
├── validationResult
├── executionResults
├── repairAttempts
├── errors
├── metrics
├── createdAt
└── updatedAt
```

* [ ] Create database schema.
* [ ] Create repository/service.
* [ ] Create AgentRun creation flow.
* [ ] Persist every state transition.
* [ ] Support resuming interrupted runs.
* [ ] Support failed runs.
* [ ] Support completed runs.
* [ ] Support cancellation.

---

# 2. Agent State Machine

## 2.1 Define states

```text
CREATED
↓
UNDERSTANDING
↓
PLANNING
↓
BUILDING
↓
STATIC_VALIDATION
↓
EXECUTING
↓
RUNTIME_VALIDATION
↓
COMPLETED
```

Failure path:

```text
EXECUTING
↓
FAILED
↓
DIAGNOSING
↓
REPAIRING
↓
EXECUTING
```

* [ ] Implement state enum.
* [ ] Implement state transitions.
* [ ] Reject invalid transitions.
* [ ] Persist transitions.
* [ ] Add timestamps for every state.
* [ ] Add transition reason.
* [ ] Add failure reason.

### Example

```json
{
  "from": "EXECUTING",
  "to": "REPAIRING",
  "reason": "Zoho API returned invalid field error"
}
```

### Done when

* Jaafar can resume from the last valid state.
* A failed run can enter repair mode.
* A completed run cannot accidentally continue modifying the workflow.

---

# 3. Context Manager

## 3.1 Build Context Manager

Jaafar should never receive random raw context.

Create a context builder that decides what information the current stage actually needs.

* [ ] Load business profile.
* [ ] Load organization information.
* [ ] Load connected integrations.
* [ ] Load previous relevant workflows.
* [ ] Load user request.
* [ ] Load relevant conversation history.
* [ ] Load previous failures when relevant.
* [ ] Load user preferences.
* [ ] Remove irrelevant context.
* [ ] Set context size limits.
* [ ] Build stage-specific context.

### Context types

```text
BusinessContext
IntegrationContext
ConversationContext
WorkflowContext
FailureContext
UserPreferenceContext
```

---

# 4. Business Context

## 4.1 Business Profile

Store:

* [ ] Business name.
* [ ] Business description.
* [ ] Industry.
* [ ] Business model.
* [ ] Main products/services.
* [ ] Sales channels.
* [ ] Customer acquisition channels.
* [ ] Operational processes.
* [ ] Connected tools.
* [ ] Important business rules.

Example:

```text
Business:
E-commerce

Sales:
Shopify

CRM:
Zoho

Communication:
WhatsApp + Gmail

Internal:
Slack

Important rule:
Orders above $500 require sales review.
```

### Done when

Jaafar can answer:

> "What does this business do?"

without asking the user again.

---

# 5. Integration Capability Registry

## 5.1 Build Integration Registry

Jaafar needs a reliable representation of what is actually connected.

For every integration store:

```text
Integration
├── provider
├── connectionStatus
├── credentialsAvailable
├── capabilities
├── supportedOperations
└── metadata
```

Example:

```text
Zoho CRM
Connected

Capabilities:
✓ Search Contact
✓ Create Contact
✓ Update Contact
✓ Create Deal
```

* [ ] Detect connected n8n credentials.
* [ ] Map credentials to integrations.
* [ ] Detect available operations.
* [ ] Cache capabilities.
* [ ] Refresh capabilities when required.
* [ ] Never expose secrets to the LLM.
* [ ] Expose only safe capability metadata.

---

# 6. n8n Node Registry

## 6.1 Node discovery

Build a searchable registry for available n8n nodes.

* [ ] Index node names.
* [ ] Index node descriptions.
* [ ] Index operations.
* [ ] Index credentials.
* [ ] Index required parameters.
* [ ] Index optional parameters.
* [ ] Index input types.
* [ ] Index output types.

---

# 7. Node Schema Tool

Implement:

```text
get_node_schema(nodeType, operation)
```

Return:

```json
{
  "node": "Slack",
  "operation": "sendMessage",
  "required": [
    "channel",
    "text"
  ],
  "optional": [],
  "credentials": [
    "slackOAuth2"
  ]
}
```

* [ ] Implement schema retrieval.
* [ ] Validate requested node exists.
* [ ] Validate requested operation exists.
* [ ] Return structured errors.
* [ ] Prevent hallucinated operations.

---

# 8. Jaafar Tool Layer

Create explicit tools for Jaafar.

## Integration tools

* [ ] `list_integrations`
* [ ] `get_integration`
* [ ] `get_integration_capabilities`

## n8n tools

* [ ] `search_nodes`
* [ ] `get_node_schema`
* [ ] `create_workflow`
* [ ] `get_workflow`
* [ ] `add_node`
* [ ] `configure_node`
* [ ] `connect_nodes`
* [ ] `update_node`
* [ ] `delete_node`

## Execution tools

* [ ] `execute_workflow`
* [ ] `get_execution`
* [ ] `get_execution_logs`
* [ ] `inspect_node_error`

## Validation tools

* [ ] `validate_workflow`
* [ ] `validate_node`
* [ ] `validate_expression`

---

# 9. Tool Contract System

Every tool must have:

```text
Name
Description
Input schema
Output schema
Errors
Permissions
Side effects
```

* [ ] Use strict JSON schemas.
* [ ] Validate tool arguments before execution.
* [ ] Validate tool results before returning them to Jaafar.
* [ ] Clearly identify destructive operations.
* [ ] Add permission checks.
* [ ] Add timeout handling.
* [ ] Add retry policy.

---

# 10. Intent Understanding

Create a dedicated intent-analysis stage.

Input:

```text
"I want every new Shopify order to be added to Zoho."
```

Output:

```json
{
  "goal": "Sync Shopify orders to Zoho",
  "trigger": "new Shopify order",
  "action": "create/update Zoho customer/order",
  "entities": [
    "Shopify",
    "Zoho"
  ]
}
```

* [ ] Extract primary goal.
* [ ] Extract trigger.
* [ ] Extract actions.
* [ ] Extract entities.
* [ ] Extract conditions.
* [ ] Extract constraints.
* [ ] Extract desired outcome.
* [ ] Identify ambiguity.

---

# 11. Requirement Extraction

Create structured requirements.

Example:

```json
{
  "requirements": [
    {
      "id": "R1",
      "description": "Receive new Shopify order",
      "priority": "required"
    },
    {
      "id": "R2",
      "description": "Find customer in Zoho",
      "priority": "required"
    }
  ]
}
```

* [ ] Assign unique requirement IDs.
* [ ] Mark required/optional.
* [ ] Track requirement coverage.
* [ ] Prevent requirements from disappearing between stages.

---

# 12. Assumption Engine

Jaafar needs explicit rules for assumptions.

## Automatically decide when:

* [ ] A connected integration is obvious.
* [ ] A safe default exists.
* [ ] The choice is reversible.
* [ ] The user intent is clear.

## Ask user when:

* [ ] Money is involved.

* [ ] Data deletion is involved.

* [ ] Security/privacy is affected.

* [ ] Multiple business outcomes are possible.

* [ ] The action is irreversible.

* [ ] A required credential is missing and no alternative exists.

* [ ] Record assumptions.

* [ ] Include assumptions in AgentRun.

* [ ] Make assumptions visible to the user when appropriate.

Example:

```text
Assumption:
Slack was selected because it is the connected internal
notification channel.
```

---

# 13. Automation Planner

Create a dedicated planner.

Input:

```text
Intent
Requirements
Business Context
Integrations
Constraints
```

Output:

```text
Automation Plan
```

---

# 14. Automation Plan Schema

Create a stable intermediate representation.

Example:

```json
{
  "goal": "Process Shopify orders",

  "trigger": {
    "provider": "shopify",
    "event": "order.created"
  },

  "steps": [
    {
      "id": "validate_order",
      "type": "validation"
    },
    {
      "id": "find_customer",
      "provider": "zoho",
      "operation": "search_contact"
    },
    {
      "id": "create_customer",
      "condition": "customer_not_found",
      "provider": "zoho",
      "operation": "create_contact"
    },
    {
      "id": "notify_team",
      "provider": "slack",
      "operation": "send_message"
    }
  ]
}
```

* [ ] Define JSON schema.
* [ ] Validate every plan.
* [ ] Ensure every requirement maps to a plan step.
* [ ] Ensure every integration exists.
* [ ] Ensure every operation exists.
* [ ] Ensure conditions are explicit.
* [ ] Ensure expected output is defined.

---

# 15. Plan Review

Before building:

* [ ] Verify trigger.
* [ ] Verify actions.
* [ ] Verify conditions.
* [ ] Verify integrations.
* [ ] Verify data flow.
* [ ] Verify error handling.
* [ ] Verify idempotency.
* [ ] Verify expected outcome.

If invalid:

```text
Planner → Fix Plan → Validate Again
```

Do not start building an invalid plan.

---

# 16. Workflow Builder

The builder converts:

```text
Automation Plan
        ↓
n8n Workflow
```

* [ ] Create workflow.
* [ ] Create trigger.
* [ ] Add nodes.
* [ ] Configure nodes.
* [ ] Connect nodes.
* [ ] Configure expressions.
* [ ] Configure credentials.
* [ ] Add branches.
* [ ] Add loops.
* [ ] Add transformations.
* [ ] Add error handling.
* [ ] Add retries.
* [ ] Add idempotency.
* [ ] Add node names.
* [ ] Add workflow notes.

---

# 17. Incremental Building

Do not build huge workflows blindly.

Build in logical groups:

```text
Trigger
↓
Core processing
↓
Business logic
↓
Integrations
↓
Notifications
↓
Error handling
```

* [ ] Save after major stages.
* [ ] Validate after major stages.
* [ ] Track workflow version.
* [ ] Roll back failed modifications.

---

# 18. Expression Safety

This is a major source of n8n failures.

* [ ] Validate every generated expression.
* [ ] Verify referenced node exists.
* [ ] Verify referenced field exists.
* [ ] Verify expected data structure.
* [ ] Detect undefined values.
* [ ] Detect invalid syntax.
* [ ] Prevent references to future/unreachable nodes.

Example failure:

```text
{{ $json.customer.email }}
```

when:

```text
customer = undefined
```

should be caught before execution where possible.

---

# 19. Static Workflow Validator

Implement a validator that checks the workflow before execution.

## Structure

* [ ] Trigger exists.
* [ ] Nodes exist.
* [ ] Connections are valid.
* [ ] No orphan nodes.
* [ ] No unreachable nodes.
* [ ] No cycles unless intentionally supported.
* [ ] Workflow has valid entry point.

## Configuration

* [ ] Required fields exist.
* [ ] Credentials exist.
* [ ] Operations are valid.
* [ ] Expressions are valid.

## Logic

* [ ] Required branches exist.
* [ ] Requirements are covered.
* [ ] Error paths exist.
* [ ] Idempotency is implemented when required.

---

# 20. Requirement Coverage Validator

Map:

```text
Requirement → Workflow Nodes
```

Example:

```text
R1:
Receive Shopify order
→ Shopify Trigger

R2:
Find customer
→ Zoho Search Customer

R3:
Create customer if missing
→ IF + Zoho Create Contact
```

* [ ] Build requirement coverage map.
* [ ] Detect uncovered requirements.
* [ ] Block completion if required requirements are uncovered.

---

# 21. Workflow Execution

After static validation:

* [ ] Generate realistic test data.
* [ ] Execute workflow.
* [ ] Capture execution ID.
* [ ] Monitor execution.
* [ ] Capture outputs.
* [ ] Capture errors.
* [ ] Capture execution duration.
* [ ] Capture node-level results.

---

# 22. Runtime Validator

After execution:

* [ ] Verify workflow completed.
* [ ] Verify expected nodes executed.
* [ ] Verify expected outputs.
* [ ] Verify external API responses.
* [ ] Verify expected side effects.
* [ ] Verify no unexpected side effects.
* [ ] Verify branches.
* [ ] Verify data transformations.

Success should mean:

```text
Execution successful
+
Requirements satisfied
+
Expected side effects verified
```

---

# 23. Self-Repair Engine

When execution fails:

```text
Execution Error
↓
Error Analyzer
↓
Root Cause
↓
Repair Plan
↓
Workflow Modification
↓
Static Validation
↓
Execute
```

* [ ] Detect failed node.
* [ ] Extract error message.
* [ ] Inspect relevant node configuration.
* [ ] Inspect previous node output.
* [ ] Determine root cause.
* [ ] Generate repair strategy.
* [ ] Apply repair.
* [ ] Revalidate.
* [ ] Reexecute.

---

# 24. Repair Limits

Prevent infinite loops.

```text
MAX_REPAIR_ATTEMPTS = 3
```

* [ ] Count attempts.
* [ ] Persist attempts.
* [ ] Stop after maximum.
* [ ] Escalate to user.
* [ ] Explain exact blocker.

---

# 25. Error Classification

Classify errors:

```text
CREDENTIAL_ERROR
PERMISSION_ERROR
INVALID_CONFIGURATION
INVALID_EXPRESSION
MISSING_DATA
API_ERROR
RATE_LIMIT
TIMEOUT
LOGIC_ERROR
UNKNOWN
```

* [ ] Implement classifier.
* [ ] Map errors to repair strategies.
* [ ] Map unrecoverable errors to user escalation.

---

# 26. Credential Handling

Jaafar must never hallucinate credentials.

* [ ] Check credential existence.
* [ ] Check credential type.
* [ ] Never expose credential secrets to LLM.
* [ ] Detect missing credentials.
* [ ] Detect authentication failures.
* [ ] Detect permission errors.
* [ ] Explain required user action.

Example:

```text
I couldn't complete the automation because the Zoho
credential connected to n8n does not have permission
to create contacts.
```

---

# 27. Idempotency

For workflows triggered by webhooks/events:

* [ ] Identify unique event/order ID.
* [ ] Check whether event was already processed.
* [ ] Store processed IDs.
* [ ] Prevent duplicate records.
* [ ] Prevent duplicate notifications.
* [ ] Make retry safe.

Example:

```text
Shopify Order ID
↓
Already processed?
├── YES → Stop
└── NO  → Process
```

---

# 28. Workflow Versioning

* [ ] Create workflow version on every significant change.
* [ ] Store Automation Plan version.
* [ ] Store workflow version.
* [ ] Store repair changes.
* [ ] Support rollback.
* [ ] Track which Jaafar version created the workflow.

---

# 29. Agent Observability

Store a complete trace.

For every run:

```text
AgentRun
├── LLM calls
├── Tool calls
├── Tool inputs
├── Tool outputs
├── State transitions
├── Workflow changes
├── Executions
├── Errors
├── Repairs
└── Final result
```

* [ ] Implement trace IDs.
* [ ] Correlate Jaafar run with n8n execution.
* [ ] Store duration.
* [ ] Store token usage if available.
* [ ] Store tool latency.
* [ ] Store number of retries.
* [ ] Store repair count.

---

# 30. Jaafar Debug Console

Build an internal developer view.

Display:

```text
Run #123

Goal:
Automate Shopify orders

Phase:
RUNTIME_VALIDATION

Plan:
✓

Workflow:
✓ Created

Execution:
✗ Failed

Failed node:
Zoho Search Customer

Error:
Invalid field

Repair attempt:
1/3

Status:
REPAIRING
```

* [ ] Run timeline.
* [ ] State transitions.
* [ ] Tool calls.
* [ ] Workflow versions.
* [ ] Errors.
* [ ] Repairs.
* [ ] Execution logs.
* [ ] Final result.

---

# 31. Evaluation Framework

Create a dedicated evaluation system.

Every test case should contain:

```json
{
  "id": "shopify-001",
  "input": "...",
  "businessContext": {},
  "expectedBehavior": {},
  "requiredIntegrations": [],
  "expectedOutcome": {},
  "maxToolCalls": 30,
  "maxRepairAttempts": 3
}
```

---

# 32. Initial Evaluation Dataset

Create at least 50 tests.

## Basic

* [ ] Webhook → Slack.
* [ ] Webhook → Email.
* [ ] Form → Google Sheets.
* [ ] Schedule → Email.
* [ ] Shopify → Slack.

## Data mapping

* [ ] Nested JSON.
* [ ] Arrays.
* [ ] Missing fields.
* [ ] Optional fields.
* [ ] Data transformation.

## Business logic

* [ ] IF conditions.
* [ ] Multiple branches.
* [ ] High-value customers.
* [ ] Customer segmentation.
* [ ] Approval workflows.

## Integrations

* [ ] Shopify.
* [ ] Zoho.
* [ ] Slack.
* [ ] Gmail.
* [HTTP APIs].

## Failure handling

* [ ] Invalid credential.
* [ ] API timeout.
* [ ] Rate limit.
* [ ] Missing data.
* [Invalid expression].

## Reliability

* [ ] Duplicate webhook.
* [ ] Retry.
* [Partial failure.
* [ ] Idempotent execution.

## Ambiguous requests

* [ ] Missing notification channel.
* [ ] Multiple connected CRMs.
* [ ] Missing optional information.
* [ ] Safe default available.

## Complex

* [ ] Multi-step CRM automation.
* [ ] E-commerce order processing.
* [ ] Lead qualification.
* [ ] AI classification.
* [ ] Multi-branch workflow.

---

# 33. Evaluation Metrics

Track:

### Success

* [ ] Task Success Rate.
* [ ] Workflow Validity Rate.
* [ ] Runtime Success Rate.
* [ ] Requirement Coverage.

### Agent quality

* [ ] Tool Selection Accuracy.
* [ ] Tool Argument Accuracy.
* [ ] Plan Accuracy.
* [ ] Business Logic Accuracy.

### Efficiency

* [ ] Average LLM calls.
* [ ] Average tool calls.
* [ ] Average execution time.
* [ ] Average repair attempts.

### Reliability

* [ ] Repair Success Rate.
* [ ] Failure Rate.
* [ ] Regression Rate.
* [ ] Hallucination Rate.
* [ ] Unnecessary Question Rate.

---

# 34. Failure Memory

Create:

```text
AgentFailure
├── task
├── context
├── error
├── failedStage
├── rootCause
├── repair
├── successfulSolution
├── frequency
└── regressionTestId
```

* [ ] Store important failures.
* [ ] Classify failures.
* [ ] Group recurring failures.
* [ ] Track frequency.
* [ ] Identify root causes.
* [ ] Store successful fixes.

---

# 35. Failure → Evaluation Pipeline

Whenever an important failure occurs:

```text
Production Failure
↓
Root Cause Analysis
↓
Create Evaluation
↓
Fix Jaafar
↓
Run Evaluation
↓
Add Regression Test
```

* [ ] Allow developers to convert failures into tests.
* [ ] Automatically suggest regression tests.
* [ ] Prevent known failures from returning unnoticed.

---

# 36. Regression Testing

Before deploying a Jaafar change:

```text
New Jaafar Version
↓
50+ Evaluation Tests
↓
Compare Previous Version
↓
Detect Regression
↓
Approve / Reject
```

* [ ] Store baseline metrics.
* [ ] Compare versions.
* [ ] Detect success-rate regression.
* [ ] Detect latency regression.
* [ ] Detect tool-call regression.
* [ ] Detect increased failure rate.

---

# 37. Prompt Versioning

Do not treat prompts as random strings.

Create:

```text
PromptVersion
├── agent
├── stage
├── version
├── content
├── model
├── createdAt
└── metrics
```

* [ ] Version prompts.
* [ ] Version planner prompts.
* [ ] Version builder prompts.
* [ ] Version validator prompts.
* [ ] Track evaluation performance per prompt version.

---

# 38. Model Strategy

Do not automatically use the most expensive model everywhere.

Define model roles:

```text
Simple classification
→ cheaper model

Planning
→ stronger reasoning model

Workflow building
→ strong tool-use model

Error diagnosis
→ strong reasoning model

Simple communication
→ cheaper model
```

* [ ] Make model selection configurable.
* [ ] Measure quality vs cost.
* [ ] Measure latency.
* [ ] Test different models against the same eval dataset.

---

# 39. Business Automation Discovery

After core reliability is strong, add autonomous automation discovery.

User:

> "Analyze my business and find ways to automate it."

Jaafar:

```text
Understand Business
↓
Understand Tools
↓
Understand Processes
↓
Identify Repetitive Work
↓
Estimate Business Value
↓
Estimate Complexity
↓
Rank Opportunities
```

Output:

```text
1. Automatically qualify new leads
   Impact: High
   Complexity: Medium

2. Sync Shopify customers with CRM
   Impact: High
   Complexity: Low

3. Notify sales about high-value orders
   Impact: Medium
   Complexity: Low
```

* [ ] Build opportunity analyzer.
* [ ] Build opportunity scoring.
* [ ] Build prioritization.
* [ ] Allow Jaafar to build selected opportunities.

---

# 40. Business-Aware Automation

Jaafar should use the business model when creating workflows.

Example:

```text
Business:
Real estate

Goal:
Handle new leads

Jaafar understands:
Lead qualification is important.
Response speed matters.
CRM synchronization matters.
Sales assignment matters.
```

Therefore it can recommend:

```text
Lead
↓
AI qualification
↓
CRM
↓
Assign sales agent
↓
Notify sales
↓
Follow-up
```

* [ ] Store business rules.
* [ ] Inject relevant rules into planning.
* [ ] Evaluate business-context reasoning.

---

# 41. User Experience

The user should see meaningful progress.

Example:

```text
Understanding your request
✓

Planning the automation
✓

Building the workflow
✓

Testing the workflow
⏳

Fixing an issue
⏳
```

* [ ] Add real-time run status.
* [ ] Show current phase.
* [ ] Show meaningful descriptions.
* [ ] Don't expose unnecessary internal reasoning.
* [ ] Don't claim success before validation.

---

# 42. Failure UX

When Jaafar fails:

Bad:

```text
Something went wrong.
```

Good:

```text
I couldn't finish the automation.

The Zoho connection doesn't have permission to create
contacts.

Everything else has been built and validated.

Connect a Zoho account with contact-creation permission
and I can continue.
```

* [ ] Show actual blocker.
* [ ] Show what succeeded.
* [ ] Show what failed.
* [ ] Show required user action.
* [ ] Allow resume after fixing the issue.

---

# 43. Resume Capability

If user fixes a missing credential:

```text
Failed Run
↓
Credential Added
↓
Resume
↓
Continue from failed stage
```

* [ ] Persist AgentRun.
* [ ] Persist current state.
* [ ] Persist workflow ID.
* [ ] Resume from last valid state.
* [ ] Avoid rebuilding everything.

---

# 44. Permissions & Safety

Before executing workflows:

* [ ] Identify destructive operations.
* [ ] Identify external side effects.
* [ ] Require confirmation for high-risk operations when appropriate.
* [ ] Never expose secrets to models.
* [ ] Respect organization permissions.
* [ ] Respect user permissions.
* [ ] Audit important actions.

---

# 45. Production Guardrails

* [ ] Maximum tool calls.
* [ ] Maximum execution time.
* [ ] Maximum repair attempts.
* [ ] Maximum workflow modifications per run.
* [ ] API timeout.
* [ ] LLM timeout.
* [ ] Cost limit.
* [ ] Loop detection.
* [ ] Duplicate execution prevention.

Example:

```text
MAX_TOOL_CALLS = 50
MAX_REPAIR_ATTEMPTS = 3
MAX_EXECUTION_TIME = 5 minutes
```

---

# 46. Agent Quality Dashboard

Create internal metrics dashboard.

Display:

```text
Jaafar Quality

Success Rate       91%
Workflow Validity  95%
Repair Success     82%
Avg Tool Calls     14
Avg Repairs        0.8
Avg Runtime        21s
Failure Rate       9%
```

* [ ] Track metrics by version.
* [ ] Track metrics by model.
* [ ] Track metrics by integration.
* [ ] Track metrics by task complexity.
* [ ] Track common failures.

---

# 47. Jaafar Versioning

Define:

```text
Jaafar v0.1
Jaafar v0.2
Jaafar v0.3
```

A version should include:

```text
Model
Prompts
Planner
Builder
Validator
Tools
Policies
```

* [ ] Store version metadata.
* [ ] Compare versions.
* [ ] Roll back versions.
* [ ] Associate production runs with version.

---

# 48. Release Gate

A new Jaafar version cannot ship unless:

* [ ] Evaluation suite passes.
* [ ] No critical regression.
* [ ] Workflow success rate meets threshold.
* [ ] Runtime success rate meets threshold.
* [ ] Repair success rate meets threshold.
* [ ] No critical security issues.
* [ ] Cost/latency is acceptable.

---

# 49. Initial Success Targets

For the first reliable Jaafar version:

```text
Basic workflow success:
> 90%

Workflow static validity:
> 95%

Runtime execution success:
> 90%

Repair success:
> 70%

Unnecessary questions:
< 10%

Critical hallucinations:
~ 0%

Successful completion without verification:
0%
```

These are engineering targets, not permanent benchmarks. Increase them as your evaluation dataset becomes stronger.

---

# 50. Final Jaafar Architecture

The target system should look like:

```text
                         USER
                           │
                           ↓
                  ┌─────────────────┐
                  │ Context Manager │
                  └────────┬────────┘
                           ↓
                  ┌─────────────────┐
                  │ Intent Analyzer │
                  └────────┬────────┘
                           ↓
                  ┌─────────────────┐
                  │ Business        │
                  │ Analyzer        │
                  └────────┬────────┘
                           ↓
                  ┌─────────────────┐
                  │ Automation      │
                  │ Planner         │
                  └────────┬────────┘
                           ↓
                  ┌─────────────────┐
                  │ Plan Validator  │
                  └────────┬────────┘
                           ↓
                  ┌─────────────────┐
                  │ Workflow        │
                  │ Builder         │
                  └────────┬────────┘
                           ↓
                  ┌─────────────────┐
                  │ Static          │
                  │ Validator       │
                  └────────┬────────┘
                           ↓
                         n8n
                           ↓
                      EXECUTION
                           ↓
                  ┌─────────────────┐
                  │ Runtime         │
                  │ Validator       │
                  └────────┬────────┘
                           ↓
                    ┌──────┴──────┐
                    │             │
                  PASS          FAIL
                    │             │
                    ↓             ↓
                 COMPLETE      DIAGNOSE
                                  ↓
                               REPAIR
                                  ↓
                              VALIDATE
                                  ↓
                              EXECUTE
```

Alongside everything:

```text
                 ┌────────────────────┐
                 │   OBSERVABILITY     │
                 └─────────┬──────────┘
                           ↓
                        TRACES
                           ↓
                       FAILURES
                           ↓
                     EVALUATIONS
                           ↓
                    REGRESSION TESTS
                           ↓
                    BETTER JAAFAR
```

---

# Implementation Order

Do NOT implement everything simultaneously.

## Milestone 1 — Reliable Execution

* [ ] AgentRun
* [ ] State machine
* [ ] Context Manager
* [ ] Integration Registry
* [ ] n8n Node Registry
* [ ] Tool contracts
* [ ] Automation Plan
* [ ] Workflow Builder
* [ ] Static Validator
* [ ] Execution
* [ ] Runtime Validator

**Goal:**

> Jaafar can build and verify simple workflows reliably.

---

## Milestone 2 — Self Repair

* [ ] Error classification
* [ ] Error analyzer
* [ ] Repair planner
* [ ] Automatic workflow repair
* [ ] Retry
* [ ] Repair limits
* [ ] Resume capability

**Goal:**

> Jaafar can recover from common workflow failures without the user.

---

## Milestone 3 — Agent Evaluation

* [ ] Tracing
* [ ] 50 evaluation tasks
* [ ] Metrics
* [ ] Failure storage
* [ ] Regression tests
* [ ] Prompt versioning
* [ ] Agent versioning

**Goal:**

> You can objectively measure whether Jaafar is getting better.

---

## Milestone 4 — Business Intelligence

* [ ] Business Context
* [ ] Business Analyzer
* [ ] Automation Opportunity Discovery
* [ ] Opportunity Ranking
* [ ] Business-aware Planning

**Goal:**

> Jaafar understands the business, not just the workflow request.

---

## Milestone 5 — Continuous Improvement

```text
Production
↓
Observe
↓
Detect Failure
↓
Analyze
↓
Create Eval
↓
Fix
↓
Run Regression
↓
Release
↓
Production
```

* [ ] Automated failure collection
* [ ] Failure clustering
* [ ] Regression generation
* [ ] Version comparison
* [ ] Quality dashboard
* [ ] Release gates

**Goal:**

> Every real-world failure becomes an opportunity to make Jaafar better.

---

# Definition of a "Good Jaafar"

Jaafar should behave like this:

```text
User:
"Whenever I get a new Shopify order,
add the customer to my CRM and notify sales."

Jaafar:

1. Understands the goal
2. Checks business context
3. Checks connected integrations
4. Finds Shopify + Zoho + Slack
5. Makes safe assumptions
6. Creates Automation Plan
7. Validates the plan
8. Builds the n8n workflow
9. Validates the workflow
10. Executes a test
11. Detects any errors
12. Repairs errors automatically
13. Executes again
14. Verifies the result
15. Marks the automation as READY
16. Explains what was built
```

The key principle:

> **Jaafar's job is not to generate a workflow. Jaafar's job is to produce a verified business outcome.**
