# Woops Agent Execution Pipeline

The Agent follows a deterministic execution pipeline.

Every request must pass through each stage in order.

A stage may be skipped only when explicitly marked as optional.

The Agent must never jump directly to execution.

---

# Stage 1 — Understanding

## Purpose

The first responsibility of the Agent is to fully understand the user's objective.

The Agent should identify

- The user's goal
- The requested outcome
- Business domain
- Required capabilities
- Constraints
- Missing information

The Agent must never make assumptions.

If the request is ambiguous,

the Agent should ask follow-up questions until the objective becomes clear.

---

## Output

The Understanding stage produces

- Goal
- Requirements
- Constraints
- Missing Information
- Business Context

Only after a complete understanding can the Agent continue.

---

# Stage 2 — Requirements Analysis

## Purpose

The Agent analyzes what is required to complete the task.

This stage identifies

- Required Skills
- Required Integrations
- Required Channels
- Required Business Knowledge
- Required User Inputs
- Required Permissions

The Agent should understand every dependency before planning.

---

## Output

Requirements Checklist

Example

✓ Gmail Integration

✓ WhatsApp Channel

✓ CRM Skill

✓ Customer Data

✓ Approval Required

---

# Stage 3 — Integration Validation (Optional)

## Purpose

Some tasks require external applications.

Examples

Google Calendar

Slack

WhatsApp

Shopify

HubSpot

Stripe

Meta

The Agent should determine

Does this task require an external integration?

If not,

skip this stage.

---

## Validation Rules

The Agent should check

- Integration exists
- OAuth connected
- Credentials valid
- Permissions granted
- Service available

The Agent never performs OAuth.

OAuth belongs to the Integration Domain.

The Agent only validates readiness.

---

## Channel Validation

If communication is required,

the Agent should verify

- WhatsApp connected
- Instagram connected
- Messenger connected
- Email configured

Channels belong to the Channel Domain.

The Agent only validates availability.

---

## Output

Integration Status

Ready

Not Connected

Permission Missing

Unavailable

---

# Stage 4 — Planning

## Purpose

The Planner creates a complete execution plan.

The plan should contain

- Goal
- Required Skills
- Skill Order
- Required Inputs
- Required Integrations
- Expected Output
- Success Criteria

The plan should be deterministic.

The Agent should avoid unnecessary complexity.

---

## Planning Rules

The Planner should

Reuse existing Skills

Prefer the smallest execution path

Avoid duplicate work

Validate dependencies

Respect business policies

Never create business logic

---

## Output

Execution Plan

---

# Stage 5 — User Approval

## Purpose

Before implementation,

the Agent presents the execution plan to the user.

The user may

Approve

Reject

Modify

Add Steps

Remove Steps

Reorder Steps

The Agent should never execute without approval.

---

## Output

Approved Execution Plan

---

# Stage 6 — Workflow Generation

## Purpose

After approval,

the Agent converts the execution plan into a machine-readable workflow.

This workflow is the implementation blueprint.

The generated workflow must contain

Nodes

Connections

Conditions

Variables

Tools

Inputs

Outputs

Triggers

Metadata

The workflow should follow the Woops Workflow Schema.

The Agent should never generate platform-specific business logic.

---

## Output

Workflow JSON

The generated JSON becomes the execution payload for the Runtime.

---

# Stage 7 — Runtime Execution

## Purpose

The Runtime executes the approved workflow.

Execution is delegated to the Workflow Engine.

Current Engine

n8n

The Agent does not execute workflows.

The Runtime sends

Workflow JSON

↓

n8n Engine

↓

Execution Result

↓

Runtime

↓

User Response

---

# Design Rules

1. Every request starts with Understanding.
2. The Agent must fully understand the user's objective before planning.
3. The Agent must identify all dependencies before execution.
4. Integrations and Channels are validated, never managed.
5. OAuth belongs to the Integration Domain.
6. Channels belong to the Channel Domain.
7. Planning must produce a complete execution plan.
8. The user always reviews the plan before execution.
9. Workflow generation begins only after approval.
10. The generated workflow must follow the Woops Workflow Schema.
11. The Runtime executes workflows.
12. n8n is the execution engine, not the decision engine.
13. The Agent is responsible for thinking.
14. The Runtime is responsible for execution.
15. The workflow is the contract between the Agent and the Runtime.