# PLAN — Credential-Independent Workflow Building

> Version: 1.0 (Draft — for review, **no code changed yet**)
> Parent: [[@RULE.AUTOMATIONS.md]]
> Affected rules: [[@RULE.AGENT.Jaafar.md]], [[@RULE.ARCHITECTURE.md]], [[@RULE.DB.md]]
> Scope: Jaafar automation design → build → provision → runtime readiness

---

# 1. Objective

Change Jaafar so provider credentials (Gmail, Slack, Shopify, HubSpot, etc.)
are no longer a build-time requirement.

The user's n8n instance remains mandatory.

Jaafar must create and save a workflow even when provider credentials are
not connected. Missing credentials affect readiness and execution only.

```text
n8n = connected
Gmail = disconnected
Slack = disconnected
        ↓
Gmail Trigger
      ↓
AI Processing
      ↓
Slack
        ↓
saved but inactive
```

---

# 2. Product Decisions

## 2.1 n8n connection remains mandatory

```text
ACTIVE n8n connection
        ↓
required to provision the workflow
```

Do NOT:

- make `Automation.connectionId` nullable
- add local-only workflow artifacts
- support workflow creation without an n8n instance

That is a separate future architecture decision.

Current enforcement to keep:

- `src/modules/automations/services/automations.service.ts:67-71`
  - `createFromBlueprint()` throws `No ACTIVE n8n connection found` when none exists.
- `prisma/schema.prisma:564-587`
  - `Automation.connectionId` remains required.

## 2.2 Provider credentials are optional during build

```text
n8n connected ✅
Gmail connected ❌
Slack connected ❌
        ↓
still build complete workflow
```

## 2.3 Missing credentials are readiness blockers

Missing credentials must produce:

```text
buildable = true
readyToRun = false
```

They must NOT produce:

```text
FAILED
UNKNOWN_INTEGRATION
BUILD_ERROR
```

## 2.4 Unknown integrations remain errors

```text
Known integration + missing credential
→ NEEDS_CREDENTIAL
→ continue build
```

versus:

```text
Unknown / hallucinated integration
→ UNKNOWN_INTEGRATION
→ reject
```

---

# 3. Target Lifecycle

Current lifecycle:

```text
DESIGN
→ PENDING_APPROVAL
→ PROVISIONING
→ ACTIVE / FAILED
```

Target behavior:

```text
DESIGN
    ↓
PENDING_APPROVAL
    ↓
BUILDING
    ↓
BUILDABLE
    │
    ├── credentials ready
    │       ↓
    │   READY_TO_RUN
    │
    └── credentials missing
            ↓
        BUILDABLE
        readyToRun = false
```

Do not necessarily introduce new enum statuses if independent readiness
fields can represent this cleanly. Prefer separating lifecycle status from
readiness.

Valid resulting state:

```json
{
  "status": "ACTIVE",
  "buildable": true,
  "readyToRun": false
}
```

Here `ACTIVE` means:

> The workflow was successfully created/provisioned in n8n.

It does NOT mean:

> The workflow currently has all credentials required for execution.

Readiness must be determined from `readyToRun`, not from
`status === ACTIVE`.

---

# 4. Separate Static Blueprint From Dynamic Readiness

Critical architectural requirement.

## Blueprint: STATIC, immutable after approval

Describes:

- nodes
- integrations
- node types
- connections
- required credential types

It must NOT contain mutable credential readiness such as:

```text
NEEDS_CREDENTIAL
CONFIGURED
```

because credential state can change without changing the workflow.
Storing dynamic readiness in the blueprint would incorrectly change
`blueprintRevision()`.

Current blueprint schema:

- `src/modules/automations/schemas/automation-blueprint.schema.ts:40-87`
- contains no credential readiness metadata
- `blueprintRevision()` intentionally excludes readiness metadata

Recommendation:

- keep the blueprint static;
- optionally add a static `credentialType` / required-credential declaration;
- store current credential state only on `Automation`.

## Automation readiness: DYNAMIC

Add to `Automation`:

```prisma
buildable          Boolean @default(false)
readyToRun         Boolean @default(false)
readinessBlockers  Json?
```

Keep:

```prisma
connectionId String
```

required.

Example persisted readiness:

```json
{
  "buildable": true,
  "readyToRun": false,
  "readinessBlockers": [
    {
      "nodeId": "gmail-trigger",
      "integration": "gmail",
      "credentialStatus": "NEEDS_CREDENTIAL",
      "credentialType": "gmailOAuth2"
    },
    {
      "nodeId": "slack-send",
      "integration": "slack",
      "credentialStatus": "NEEDS_CREDENTIAL",
      "credentialType": "slackOAuth2"
    }
  ]
}
```

```text
                 WORKFLOW
                    │
        ┌───────────┴───────────┐
        │                       │
     Blueprint               Readiness
      STATIC                  DYNAMIC
        │                       │
        │                       ├── credentials
        │                       ├── blockers
        │                       └── readyToRun
        │
        ├── nodes
        ├── integrations
        ├── node types
        └── connections
```

---

# 5. Shared Readiness Types

Create shared types, for example in automations or runtime:

```ts
export type CredentialStatus =
  | 'CONFIGURED'
  | 'NOT_CONFIGURED'
  | 'NEEDS_CREDENTIAL';

export interface ReadinessBlocker {
  nodeId: string;
  integration: string;
  credentialStatus: CredentialStatus;
  credentialType?: string;
}

export interface WorkflowReadiness {
  buildable: boolean;
  readyToRun: boolean;
  readinessBlockers: ReadinessBlocker[];
}
```

Minimum practical implementation may only need:

```ts
type CredentialStatus = 'CONFIGURED' | 'NEEDS_CREDENTIAL';
```

Use `NOT_CONFIGURED` only if the API must distinguish “node has no
configured credential field” from “required credential actively detected
as missing.”

Expose readiness through:

- `AutomationView`
- repository mapping
- API responses
- UI readiness representation where applicable

Do not expose credential secrets or internal credential values.

---

# 6. Known Provider Resolution

Problem:

- `AutomationPlanReviewService` currently marks every integration absent
  from capabilities as `UNKNOWN_INTEGRATION`.
- `src/modules/runtime/services/automation-plan-review.service.ts:143-157`
- The graph then stops and asks the user to connect the integration.
- `src/modules/runtime/services/jaafar-automation-graph.service.ts:638-685`

The current capability list alone cannot distinguish:

```text
absent known provider
```

from:

```text
hallucinated provider
```

Required:

Introduce or reuse a provider catalog/registry capable of determining:

- known provider
- provider aliases
- native n8n node mapping
- expected credential types

Candidate sources already in the codebase:

- `CREDENTIAL_TYPE_ALIASES` in
  `src/modules/runtime/services/integration-registry.service.ts:46-74`
- `SUGGESTED_NODE_TYPES` in
  `src/modules/runtime/services/integration-registry.service.ts:80-95`
- curated node schemas in
  `src/infrastructure/n8n/n8n-node-inventory.service.ts:88-180`
- platform `Integration` rows, including `DISCONNECTED` providers

Rules:

- known provider + no credential → valid plan + readiness warning
- unknown provider → `UNKNOWN_INTEGRATION`
- existing `DISCONNECTED` platform integrations remain known providers
- do NOT use credential availability to determine whether a provider exists

---

# 7. Update AutomationPlanReviewService

File:

```text
src/modules/runtime/services/automation-plan-review.service.ts
```

## New behavior

```text
Known integration
+
credential unavailable
=
warning/readiness blocker
```

Plan remains valid.

## Keep rejecting

- invented integrations
- unsupported integrations
- malformed integration identifiers
- structurally invalid plans
- invalid node hints
- uncovered requirements
- confidently invalid node types
- unsupported workflow definitions

Do not weaken hallucination protection.

Important:

```text
Credential unavailable
≠
Node invalid
```

Credential availability and node availability are separate concepts.

---

# 8. Preserve Original Integration Information

The planner must preserve:

```text
step.integration
nodeHint.type
workflow structure
```

Example:

```json
{
  "integration": "gmail",
  "nodeHint": {
    "type": "n8n-nodes-base.gmailTrigger"
  }
}
```

must NOT become:

```text
unknown node
```

or:

```text
removed node
```

solely because Gmail is disconnected.

---

# 9. Update JaafarAutomationGraphService

File:

```text
src/modules/runtime/services/jaafar-automation-graph.service.ts
```

## Remove

```text
Gmail disconnected
        ↓
ask user to connect Gmail
        ↓
stop
```

## Replace with

```text
Gmail known
        ↓
credential missing
        ↓
record readiness warning
        ↓
continue planning/building
```

Jaafar may still ask clarification when the answer changes workflow structure:

```text
"Which CRM should I use?"
```

valid if CRM determines the node to create.

But:

```text
"Connect Gmail before I can build this."
```

is NOT valid when the Gmail node can already be determined.

Concrete change area:

- review-plan branch around current lines `638-685`
- preserve unknown-integration blocking
- preserve structural clarification
- pass disconnected capabilities into planning/validation
- produce post-build readiness messaging instead of pre-build credential request

---

# 10. Node Validation

Keep node validation.

If connected n8n inventory can verify the node:

```text
validate normally
```

If verification is unavailable solely because provider credential is missing:

```text
retain node
+
readiness warning
```

Do NOT downgrade a confidently invalid/hallucinated node into a credential warning.

Relevant current code:

- `src/modules/runtime/services/automation-workflow-builder.service.ts:255-315`
- missing connection currently produces `UNMAPPED_STEP` warning
- unknown node schema currently produces `INVALID_PLAN`
- preserve that distinction

---

# 11. Credential Readiness Inspection

Implement a dedicated readiness inspection step.

Use available n8n metadata such as:

```text
N8nNodeSchema.credentials
Observed inventory credential types
Existing credential identities from listCredentials()
Provider → credential-type mappings
```

For every generated integration node determine:

```text
Does this node require credentials?
What credential type does it require?
Is a matching credential available?
```

Examples:

```text
Code
→ requires credential? NO
→ blocker? NO
```

```text
Gmail Trigger
→ requires credential? YES
→ Gmail credential available? NO
→ NEEDS_CREDENTIAL
```

```text
Slack
→ requires credential? YES
→ Slack credential available? YES
→ CONFIGURED
```

Do not treat every missing credential lookup as a blocker.

Provisioner-only reuse knowledge is insufficient:

- `N8nProvisionerService.reuseCredentials()`
- `src/infrastructure/n8n/n8n-provisioner.service.ts:445-473`

only knows whether a credential was attached. Readiness inspection must
independently know whether a credential was required.

Structural/plumbing nodes must not produce blockers. Current exclusion list:

- `NO_CREDENTIAL_FALLBACK_TYPES`
- `src/infrastructure/n8n/n8n-provisioner.service.ts:52-62`

---

# 12. Handle Ambiguous Credential Matching

Current provisioner throws when fallback credential matching is ambiguous:

```text
src/infrastructure/n8n/n8n-provisioner.service.ts:468-472
```

Change where appropriate:

```text
workflow can still be created
but credential cannot be confidently resolved
        ↓
do not fail build
        ↓
create workflow
        ↓
record readiness blocker
```

Only fail when ambiguity makes workflow creation structurally impossible.

---

# 13. Refactor N8nProvisionerService

File:

```text
src/infrastructure/n8n/n8n-provisioner.service.ts
```

Current flow:

```text
createWorkflow()
→ activateWorkflow()
→ getWorkflow()
```

Change to:

```text
build workflow JSON
        ↓
createWorkflow()
        ↓
get/read workflow
        ↓
inspect credential readiness
        ↓
calculate readiness
        ↓
save external workflow ID
        ↓
if readyToRun:
    activateWorkflow()
else:
    keep workflow inactive
```

Requirements:

- creation and activation must be separate operations
- workflow must be created even if Gmail/Slack credentials are missing
- external workflow ID and webhook data must be preserved without activation
- create/read-back failures remain real provisioning failures
- missing provider credentials are successful builds with `readyToRun: false`

Confirm whether the n8n create API creates workflows inactive by default.
If not guaranteed, explicitly create with `active: false` or equivalent.

---

# 14. Activation Rule

Activation requires:

```text
buildable = true
AND
readyToRun = true
```

If:

```text
buildable = true
readyToRun = false
```

the workflow remains inactive.

Missing credentials must NEVER trigger:

```text
FAILED
```

---

# 15. Update AutomationsService

File:

```text
src/modules/automations/services/automations.service.ts
```

Keep n8n connection requirement:

```text
connection cannot resolve to ACTIVE n8n connection
→ provisioning fails
```

Current behavior to preserve:

- `provision()` returns `FAILED` when `resolveCredentials()` is null
- `src/modules/automations/services/automations.service.ts:191-203`

New successful-creation behavior for missing provider credentials:

- save external workflow ID
- save `buildable`
- save `readyToRun`
- save `readinessBlockers`
- keep status compatible with current lifecycle
- activate only when `readyToRun = true`

Do not convert missing provider credentials into `FAILED`.

Also update:

- `AutomationView`
- `toView()` mapping
- repository persistence
- version/history handling if readiness refresh should or should not bump versions

---

# 16. Update AutomationWorkflowBuilderService

File:

```text
src/modules/runtime/services/automation-workflow-builder.service.ts
```

Current behavior:

```text
automation status FAILED
→ throw
```

Relevant code:

- `src/modules/runtime/services/automation-workflow-builder.service.ts:148-153`

## Must throw/fail

- static validation errors
- invalid node types
- malformed workflow
- invalid graph structure
- n8n unavailable
- workflow creation failure
- persistence failure
- structural provisioning failure

## Must NOT throw

```text
NEEDS_CREDENTIAL
```

Return:

```json
{
  "automation": {
    "buildable": true,
    "readyToRun": false,
    "readinessBlockers": []
  },
  "validation": {}
}
```

with actual blockers populated when applicable.

---

# 17. Runtime Execution Gating

Before execution, check:

```text
readyToRun
```

If:

```text
readyToRun = false
```

return:

```text
CREDENTIALS_REQUIRED
```

Do not return:

```text
UNKNOWN_INTEGRATION
INTEGRATION_UNAVAILABLE
PROVISIONING_FAILED
```

The workflow exists; it cannot execute yet.

Files/areas to update:

```text
src/modules/runtime/services/automation-tool-resolver.service.ts
src/modules/runtime/services/tool-executor.service.ts
src/modules/runtime/interfaces/tool.interface.ts
runtime validation / test execution path in JaafarAutomationGraphService
```

Important:

- `AutomationToolResolverService` currently treats `status === ACTIVE`
  as executable.
- It must also check `readyToRun`.
- `ACTIVE + readyToRun: false` must be unavailable with
  `CREDENTIALS_REQUIRED`, not executable.
- Existing `INTEGRATION_UNAVAILABLE` semantics for missing/unusable n8n
  connections should remain distinct from provider-credential blockers.

Also decide graph behavior after inactive creation:

- structural read-back verification may still run;
- workflow test execution must be skipped while credentials are missing;
- missing-credential builds should return success with blockers rather than
  entering repair for execution failure.

---

# 18. Readiness Refresh Without Rebuild

Add:

```ts
AutomationsService.refreshReadiness()
```

Operation:

```text
Resolve existing n8n connection
        ↓
Read existing workflow / credential inventory
        ↓
Re-evaluate credential requirements
        ↓
Calculate readiness blockers
        ↓
Update Automation
        ↓
Update readyToRun
        ↓
If all blockers cleared:
    activate existing workflow
```

Do NOT call:

```text
createWorkflow()
```

again merely because a credential was added.

Possible API:

```text
POST /automations/:id/readiness/refresh
```

or integrate into existing activation/readiness flow if that fits better.

Verify after refresh:

```text
workflow ID unchanged
blueprint unchanged
workflow not recreated
```

Also consider automatically invalidating/refreshing:

- `IntegrationRegistryService` cache
- `AutomationToolResolverService` cache

after credential connection.

---

# 19. Credential Lifecycle

Expected lifecycle:

```text
Build
  ↓
Workflow created
  ↓
Gmail credential missing
  ↓
buildable = true
readyToRun = false
  ↓
User connects Gmail
  ↓
refreshReadiness()
  ↓
Gmail blocker removed
  ↓
readyToRun = true
  ↓
Existing workflow activated
```

No blueprint regeneration.

No workflow recreation.

---

# 20. User-Facing Response

One missing credential:

```text
I've built the workflow. Gmail still needs to be connected before it can run.
```

Multiple blockers:

```text
I've built the workflow successfully.

Gmail and Slack still need to be connected before the workflow can run.
```

API/agent response should include:

- workflow blueprint
- readiness state
- missing credential information

Do not expose secrets or internal credential IDs.

Replace blocking responses such as:

```text
I can't provision steps for tools I can't see.
```

---

# 21. Database Migration

Add to `Automation`:

```prisma
buildable          Boolean @default(false)
readyToRun         Boolean @default(false)
readinessBlockers  Json?
```

Create Prisma migration.

Keep:

```prisma
connectionId String
```

required.

Persistence must be atomic enough that:

- creation success + persistence failure = real build failure
- creation success + readiness false ≠ provisioning failure

---

# 22. Files Expected To Change

Primary:

```text
src/modules/runtime/services/automation-plan-review.service.ts
src/modules/runtime/services/jaafar-automation-graph.service.ts
src/modules/runtime/services/automation-workflow-builder.service.ts
src/modules/automations/services/automations.service.ts
src/modules/automations/schemas/automation-blueprint.schema.ts
src/modules/automations/constants/automation-status.constants.ts
src/infrastructure/n8n/n8n-provisioner.service.ts
```

Likely supporting changes:

```text
prisma/schema.prisma
prisma/migrations/*
src/modules/automations/repositories/automations.repository.ts
src/modules/automations/dto/automation.dto.ts
src/modules/automations/controllers/automations.controller.ts
src/modules/runtime/services/integration-registry.service.ts
src/modules/runtime/services/automation-tool-resolver.service.ts
src/modules/runtime/services/tool-executor.service.ts
src/modules/runtime/interfaces/tool.interface.ts
src/infrastructure/n8n/n8n-node-inventory.service.ts
src/infrastructure/n8n/n8n-client-api.service.ts
API responses
UI readiness representation
```

Update only where required by existing architecture.

---

# 23. Tests

## 23.1 Automation plan review

- disconnected Gmail = valid plan + warning
- disconnected Slack = valid plan + warning
- unknown FakeCRMPro = `UNKNOWN_INTEGRATION`
- disconnected provider remains in blueprint
- original integration information preserved
- invalid node types still fail
- malformed plans still fail

## 23.2 n8n provisioner

- workflow created without provider credentials
- missing credentials create readiness blockers
- activation skipped when blockers exist
- activation occurs when no blockers exist
- ambiguous credential fallback becomes readiness blocker when safe
- structural provisioning errors still fail
- external workflow ID preserved
- webhook information preserved when activation skipped

## 23.3 AutomationsService

- missing ACTIVE n8n connection still fails
- disconnected Gmail creates buildable automation
- `readyToRun = false`
- workflow remains inactive
- readiness blockers persisted
- provisioning errors still become failures
- `status = ACTIVE` can coexist with `readyToRun = false`

## 23.4 Workflow builder

- credential blockers do not throw
- returns `buildable = true`
- returns `readyToRun = false`
- readiness blockers preserved
- structural failures still throw
- provisioning failures still throw

## 23.5 Jaafar graph

- disconnected Gmail reaches build
- disconnected Slack reaches build
- Gmail/Slack not removed from plan
- blocking credential clarification not emitted
- unknown integrations still stop planning
- structural clarification still works
- final response identifies missing credentials

## 23.6 Runtime

```text
readyToRun = false
→ CREDENTIALS_REQUIRED
```

```text
readyToRun = true
→ execution allowed
```

## 23.7 Readiness refresh

```text
Gmail missing
→ readyToRun = false
```

then:

```text
Gmail connected
→ refreshReadiness()
→ readyToRun = true
→ existing workflow activated
```

Verify:

```text
workflow ID unchanged
blueprint unchanged
workflow not recreated
```

---

# 24. End-to-End Acceptance Test

Scenario:

```text
User:
"Create a workflow that triggers when I receive a Gmail
and sends a message to Slack."
```

Environment:

```text
n8n connection = ACTIVE
Gmail credential = missing
Slack credential = missing
```

Expected:

```text
Plan succeeds
        ↓
Plan review succeeds
        ↓
Gmail Trigger created
        ↓
Slack node created
        ↓
Nodes connected
        ↓
Workflow created in n8n
        ↓
Credential readiness inspected
        ↓
Gmail = NEEDS_CREDENTIAL
Slack = NEEDS_CREDENTIAL
        ↓
Automation saved
        ↓
status = ACTIVE
buildable = true
readyToRun = false
        ↓
n8n workflow remains inactive
```

Jaafar tells user:

```text
I've built the workflow successfully.

Gmail and Slack still need to be connected before the workflow can run.
```

Then:

```text
User connects Gmail + Slack
        ↓
refreshReadiness()
        ↓
readinessBlockers = []
        ↓
readyToRun = true
        ↓
existing n8n workflow activated
```

Final state:

```text
status = ACTIVE
buildable = true
readyToRun = true
readinessBlockers = []
n8n workflow = ACTIVE
```

No blueprint regeneration.

No workflow recreation.

---

# 25. Non-Goals

This implementation must NOT:

- support building without an n8n connection
- make `connectionId` nullable
- create a local-only workflow system
- remove unknown-integration validation
- weaken node validation
- automatically activate workflows with missing credentials
- recreate workflows after credentials are connected
- store mutable credential readiness inside immutable blueprint
- expose credential secrets
- treat missing credentials as `FAILED`

---

# 26. Implementation Order

Recommended execution order:

1. Prisma migration and readiness types.
2. `AutomationView`, repository, and service persistence.
3. Known-provider resolution and plan-review behavior.
4. Provisioner readiness detection and create/activate separation.
5. Builder and Jaafar graph behavior.
6. Runtime execution gating.
7. Readiness refresh endpoint/service.
8. Unit, graph, provisioning, and end-to-end regression tests.

---

# 27. Final Architectural Rule

```text
                 WORKFLOW
                    │
        ┌───────────┴───────────┐
        │                       │
     Blueprint               Readiness
      STATIC                  DYNAMIC
        │                       │
        │                       ├── credentials
        │                       ├── blockers
        │                       └── readyToRun
        │
        ├── nodes
        ├── integrations
        ├── node types
        └── connections
```

Therefore:

```text
Known integration
+
missing credential
=
VALID BUILD
+
NOT READY TO RUN
```

while:

```text
Unknown integration
=
INVALID PLAN
```

And:

```text
No n8n connection
=
PROVISIONING BLOCKED
```

These three cases must remain completely distinct.

**Missing credentials are a readiness problem, not a workflow construction problem.**
