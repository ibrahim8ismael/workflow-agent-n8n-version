````md
# Woops AI Agent Domain Architecture
> Version: 2.0
> Status: Architecture Specification
> Domain: AI Agent Core
> Owner: Woops Engineering
> Last Updated: 2026-08-28
>
> ⚠️ **ADR-011 (2026-08):** Automations live in **client-provided n8n
> instances** — Jaafar designs, the user approves, the platform provisions.
> Per-client connections (`/api/v1/integrations/n8n`) with encrypted API keys
> are the **only** way n8n is connected: each user supplies their own n8n
> domain (`baseUrl`) and API key. The platform-global n8n env configuration
> has been removed (cutover complete). Canonical rules:
> [[@RULE.AUTOMATIONS.md]]. Sections below describing platform-global n8n
> workflow mapping are historical.

---

# 1. Introduction

This document defines the official architecture of the Woops AI Agent domain.

It is considered the **single source of truth** for every engineer working on the AI platform.

This document intentionally does NOT explain implementation details.
Instead, it defines:

- Domain responsibilities
- Architectural boundaries
- Domain terminology
- Lifecycle
- Business rules
- Ownership
- Design decisions

Every implementation MUST follow this specification.

---

# 2. Vision

Woops is NOT another chatbot builder.

Woops is an AI Employee Platform.

Every Agent represents an intelligent employee capable of:

- Understanding goals
- Creating execution plans
- Executing multiple Skills
- Using Knowledge
- Using Memory
- Working through Conversations
- Collaborating with external systems

The Agent is the brain.

The Runtime is the execution engine.

n8n is the integration engine.

---

# 3. Design Principles

## AI First

Everything inside Woops is designed around AI Employees.

Not around workflows.

Not around automations.

---

## Domain Driven Design

Every module owns its own business logic.

No shared business logic across domains.

---

## Runtime Agnostic

The Agent never communicates directly with OpenAI, Anthropic or Gemini.

The Runtime Adapter is responsible.

---

## Provider Agnostic

The system should support any LLM provider.

Current implementation:

- OpenAI
- Anthropic
- Gemini
- Groq
- OpenRouter

Future providers should require zero Agent changes.

---

## Integration Agnostic

Agents never communicate directly with:

- Shopify
- Salesforce
- HubSpot
- WhatsApp
- Slack
- Stripe

They communicate only through Skills.

---

## Event Driven

Everything important produces events.

Examples

- AgentCreated
- RunStarted
- SkillCompleted
- MemoryStored

---

## Stateless Runtime

The Runtime should never permanently own business state.

Business state belongs to domains.

---

## Stateful Intelligence

The intelligence lives inside:

- Agent
- Knowledge
- Memory
- Conversation

Not inside the Runtime.

---

# 4. Core Terminology

## Agent

An AI Employee owned by an Organization.

The Agent contains:

- Identity
- Instructions
- Configuration
- Skills
- Knowledge
- Memory
- Planning Rules

The Agent is NOT a prompt.

---

## Skill

A reusable business capability.

Examples

- Search CRM
- Approve Leave
- Generate Invoice
- Lookup Employee
- Schedule Meeting

Every Agent owns one or more Skills.

Workflow is officially renamed to Skill.

Reason:

Employees have Skills.

They do not have Workflows.

---

## Run

A single execution session of an Agent.

Every request creates one Run.

A Run owns execution state only.

Nothing else.

---

## Memory

Persistent intelligence collected over time.

Memory belongs to the Agent.

Not to the Runtime.

---

## Knowledge

Structured business information used by the Agent.

Knowledge belongs to the Agent.

---

## Conversation

Represents communication history.

Conversation owns messages.

Conversation does NOT own business logic.

---

## Runtime

Responsible for executing Runs.

Current Runtime implementation uses:

Vercel AI SDK

---

## Plan

A generated execution strategy.

The Plan contains one or more Skills.

---

# 5. High Level Architecture

```
                  User
                    │
                    ▼
             Conversation
                    │
                    ▼
                 Agent
                    │
      ┌─────────────┼─────────────┐
      │             │             │
      ▼             ▼             ▼
 Knowledge      Memory        Skills
      │             │             │
      └─────────────┼─────────────┘
                    ▼
               Planning Engine
                    │
                    ▼
                  Plan
                    │
                    ▼
                  Run
                    │
                    ▼
           Vercel AI SDK Runtime
                    │
                    ▼
                 n8n Skills
                    │
                    ▼
          External Integrations
```

---

# 6. Agent Responsibilities

The Agent is responsible for

- Understanding business goals
- Planning execution
- Selecting Skills
- Managing Knowledge
- Managing Memory
- Building Context
- Producing responses
- Orchestrating Skills

The Agent is NOT responsible for

- OAuth
- API Keys
- Refresh Tokens
- Channels
- Integrations
- Streaming
- Tool Calling
- Provider SDKs

---

# 7. Agent Boundaries

The Agent owns

- Identity
- Name
- Description
- Instructions
- Model Configuration
- Temperature
- Skills
- Memory
- Knowledge
- Planning Rules
- Execution Rules
- Permissions

The Agent does NOT own

- OAuth Tokens
- Integration Credentials
- Channel Authentication
- Workflow Execution
- Message Delivery
- Webhooks

Those belong to other systems.

---

# 8. Agent Lifecycle

```
Draft

↓

Configured

↓

Published

↓

Active

↓

Paused

↓

Archived

↓

Deleted
```

---

## Draft

Agent is under construction.

Cannot receive conversations.

Cannot execute Runs.

---

## Configured

Agent has

- Instructions
- Skills
- Model
- Configuration

Still invisible.

---

## Published

Agent is ready.

Can receive conversations.

Can execute Skills.

---

## Active

Production state.

Available for users.

---

## Paused

Temporarily unavailable.

Runs cannot start.

---

## Archived

Historical only.

Cannot execute.

---

# 9. Agent Components

Each Agent consists of

```
Agent

├── Identity

├── Instructions

├── Configuration

├── Planner

├── Knowledge

├── Memory

├── Skills

├── Permissions

└── Runtime Settings
```

---

# 10. Agent Instructions

Instructions define the Agent personality.

Examples

- Role
- Goals
- Communication style
- Business rules
- Guardrails
- Limitations
- Output style

Instructions are immutable during a Run.

They become part of the Runtime Context.

---

# 11. Agent Configuration

Configuration contains

```
LLM Model

Temperature

Max Tokens

Streaming

Reasoning Mode

Language

Timezone

Memory Settings

Knowledge Settings

Planning Settings
```

Configuration never contains secrets.

---

# 12. Skill System

Workflow is officially renamed to Skill.

Reason

Employees execute Skills.

Example

```
HR Agent

├── Employee Lookup

├── Leave Approval

├── Payroll

├── Recruitment

└── Attendance
```

Sales Agent

```
Sales Agent

├── Lead Qualification

├── CRM Lookup

├── Meeting Scheduling

├── Quote Generation

└── Opportunity Creation
```

---

# 13. Skill Responsibilities

Every Skill defines

- Goal
- Description
- Required Inputs
- Preconditions
- Success Criteria
- Output Contract
- Retry Rules
- Validation Rules

A Skill may

- Call AI
- Call n8n
- Execute APIs
- Use Knowledge
- Use Memory

The Agent does not know how the Skill works internally.

---

# 14. Planning System

Planning is mandatory.

The Agent never executes a Skill immediately.

Execution flow

```
User Goal

↓

Understand Intent

↓

Identify Required Skill

↓

Collect Missing Inputs

↓

Generate Plan

↓

Validate Plan

↓

Execute Plan
```

If required information is missing

The Agent MUST ask follow-up questions.

Never guess.

---

# 15. Plan Object

A Plan contains

- Goal
- Skills
- Execution Order
- Missing Inputs
- Dependencies
- Expected Outputs
- Success Criteria

Example

```
Goal

Approve leave request

↓

Plan

1. Find employee

2. Validate balance

3. Request approval

4. Update HR system

5. Notify employee
```

The Plan is generated before execution begins.

---

# 16. Runtime

Woops does NOT implement its own LLM Runtime.

Runtime is delegated to

Vercel AI SDK

Responsibilities handled by Vercel

- Provider SDKs
- Streaming
- Tool Calling
- Structured Outputs
- Message Protocol
- Model Communication

Woops wraps Vercel behind an internal abstraction.

Agent never knows the provider.

---

# 17. n8n Responsibilities

n8n is the Automation & Integration Engine.

n8n owns

- OAuth
- Credentials
- API Keys
- Refresh Tokens
- Integrations
- Channels
- Workflow Execution
- External APIs
- Automation
- Triggers
- Scheduled Jobs

Woops Agent never owns these responsibilities.

---

# 18. Agent + n8n Contract

The Agent never asks

"Connect Salesforce"

Instead it asks

```
Is Salesforce Connected?
```

Response

```
YES
```

↓

Execute Skill

or

```
NO
```

↓

Request user to connect integration.

Exactly the same rule applies to

- WhatsApp
- Messenger
- Slack
- Shopify
- Stripe
- HubSpot
- Zoho
- Google Calendar

The Agent only knows

Available

Unavailable

Nothing more.

---

# 19. Architecture Decisions

ADR-001

Workflow is renamed to Skill.

Reason

Employees execute Skills.

---

ADR-002

Vercel AI SDK is the Runtime.

Woops focuses on orchestration.

---

ADR-003

n8n owns every Integration.

---

ADR-004

n8n owns OAuth.

---

ADR-005

n8n owns Channels.

---

ADR-006

Agent owns Memory.

---

ADR-007

Agent owns Knowledge.

---

ADR-008

Every execution creates exactly one Run.

---

ADR-009

Every Run starts with a Plan.

Execution without planning is forbidden.

```
````
````md
# 20. Run Domain

## Overview

A Run represents one complete execution lifecycle of an Agent.

Every execution creates exactly one Run.

Examples

- User sends a message
- API request
- Scheduled execution
- Human resumes an execution

All create a new Run.

The Run is the execution boundary.

---

## Responsibilities

A Run is responsible for

- Building Context
- Executing the Plan
- Tracking Execution State
- Recording Events
- Recording Costs
- Recording Token Usage
- Calling Skills
- Persisting Results

A Run never owns

- Knowledge
- Memory
- Conversations
- Integrations

It only consumes them.

---

## Run Lifecycle

```
Created
    │
    ▼
Preparing
    │
    ▼
Planning
    │
    ▼
Building Context
    │
    ▼
Executing Skills
    │
    ▼
Waiting
    │
    ▼
Generating Response
    │
    ▼
Persisting
    │
    ▼
Completed
```

Failure states

```
Failed

Cancelled

Expired

Timeout
```

---

## Run State Machine

```
Created

↓

Preparing

↓

Planning

↓

Executing

↓

Waiting

↓

Executing

↓

Generating

↓

Persisting

↓

Completed
```

Possible transitions

```
Executing

↓

Failed

Executing

↓

Cancelled

Waiting

↓

Timeout
```

---

## Run Metadata

Every Run stores

- Run ID
- Agent ID
- Organization ID
- Conversation ID
- User ID
- Parent Run
- Current State
- Started At
- Finished At
- Duration
- Total Tokens
- Prompt Tokens
- Completion Tokens
- Estimated Cost
- Execution Result

---

## Run Events

```
RunCreated

RunStarted

PlanningStarted

PlanningCompleted

ContextBuilt

SkillStarted

SkillCompleted

ResponseGenerated

MemoryUpdated

RunCompleted

RunFailed

RunCancelled
```

---

# 21. Context Engine

## Purpose

The Context Engine decides what the LLM should see.

It does NOT simply concatenate text.

It builds an optimized execution context.

---

## Context Sources

Priority order

```
System Rules

↓

Agent Instructions

↓

Current Skill

↓

Conversation

↓

Relevant Memory

↓

Relevant Knowledge

↓

Current User Message

↓

Temporary Variables
```

---

## Context Rules

Always include

- Agent Instructions
- Current User Message

Never include

- Entire Conversation
- Entire Memory
- Entire Knowledge Base

Everything must be filtered.

---

## Context Responsibilities

- Build Prompt
- Remove Noise
- Limit Token Usage
- Rank Memory
- Rank Knowledge
- Merge Context
- Preserve Execution Variables

---

## Context Pipeline

```
Conversation

↓

Memory Recall

↓

Knowledge Retrieval

↓

Skill Context

↓

Prompt Builder

↓

Runtime
```

---

# 22. Memory Domain

## Purpose

Memory allows an Agent to remember information across executions.

Memory belongs to the Agent.

Not to the Runtime.

---

## Memory Types

### Session Memory

Temporary

Destroyed after execution.

---

### Conversation Memory

Specific to one conversation.

---

### Customer Memory

Stores customer preferences.

Examples

- Preferred language
- Favorite products
- Company name

---

### Agent Memory

Long-term intelligence learned by the Agent.

---

### Organization Memory

Shared knowledge across multiple Agents.

---

## Memory Operations

```
Store

Recall

Update

Forget

Summarize

Expire

Merge
```

---

## Memory Rules

Memory should never store

- OAuth Tokens
- Passwords
- Secrets
- API Keys

Memory stores business information only.

---

## Memory Retrieval

```
User Message

↓

Semantic Search

↓

Ranking

↓

Compression

↓

Runtime Context
```

---

# 23. Knowledge Domain

## Purpose

Knowledge represents business documents available to the Agent.

Knowledge is read-only during execution.

---

## Sources

- PDF
- Website
- Documentation
- FAQ
- Manual Text
- Notion
- Google Drive
- Database
- API

---

## Ingestion Pipeline

```
Upload

↓

Parse

↓

Normalize

↓

Chunk

↓

Embedding

↓

Index

↓

Ready
```

---

## Retrieval Pipeline

```
Question

↓

Embedding

↓

Vector Search

↓

Keyword Search

↓

Hybrid Ranking

↓

Relevant Chunks

↓

Runtime
```

---

## Knowledge Rules

Knowledge never changes during a Run.

Updates happen asynchronously.

---

# 24. Conversation Domain

## Purpose

Conversation represents communication.

Nothing more.

Business logic belongs to the Agent.

---

## Conversation owns

- Messages
- Participants
- Attachments
- Timeline
- Status

---

## Conversation does NOT own

- Planning
- Skills
- Memory
- Knowledge
- Integrations

---

## Conversation States

```
Open

↓

Assigned

↓

Waiting

↓

Resolved

↓

Closed
```

---

# 25. Skill Execution

```
User Request

↓

Planner

↓

Select Skill

↓

Validate Inputs

↓

Need More Information?

↓

YES

↓

Ask User

↓

Continue

↓

NO

↓

Execute Skill

↓

Need n8n?

↓

YES

↓

Execute n8n

↓

Receive Result

↓

Continue

↓

Generate Response

↓

Store Memory

↓

Complete Run
```

---

# 26. Runtime Architecture

```
Agent

↓

Run

↓

Context Engine

↓

Planner

↓

Plan

↓

Skill Executor

↓

AI Adapter

↓

Vercel AI SDK

↓

LLM
```

Runtime never communicates directly with integrations.

Everything external passes through Skills.

---

# 27. AI Adapter

Purpose

Abstract Vercel AI SDK.

Current provider

```
Vercel AI SDK
```

Responsibilities

- Model Selection
- Streaming
- Tool Calling
- Structured Outputs
- Provider Switching

Future providers should require zero Agent changes.

---

# 28. n8n Integration Boundary

n8n owns

- OAuth
- Credentials
- Integrations
- Channels
- API Calls
- Workflow Execution
- Triggers
- Scheduling

Woops owns

- Planning
- Agent Intelligence
- Memory
- Knowledge
- Conversations
- Runs

---

## Example

```
User

↓

Book meeting

↓

Planning

↓

Meeting Skill

↓

Need Calendar

↓

n8n

↓

Google Calendar

↓

Result

↓

Agent Response
```

The Agent never knows how Google Calendar was connected.

---

# 29. Domain Events

```
AgentCreated

AgentPublished

ConversationStarted

RunCreated

PlanningStarted

PlanningCompleted

SkillStarted

SkillCompleted

KnowledgeRetrieved

MemoryStored

ResponseGenerated

ConversationUpdated

RunCompleted

RunFailed
```

Events should be immutable.

---

# 30. Folder Structure

```
packages/

agent-core/

├── agents/

├── runs/

├── planner/

├── context/

├── skills/

├── memory/

├── knowledge/

├── conversations/

├── runtime/

├── adapters/

│   └── ai/

│       └── vercel/

├── shared/

└── events/
```

---

# 31. Future Roadmap

Future versions may include

- Multi-Agent Collaboration
- Human Approval Skills
- Shared Agent Memory
- Voice Skills
- Vision Skills
- Background Runs
- Agent Marketplace
- Skill Marketplace
- Agent Versioning
- Agent Templates

---

# 32. Golden Rules

1. Agent is an AI Employee.
2. Workflow is renamed to Skill.
3. Every execution creates one Run.
4. Every Run starts with a Plan.
5. Planning is mandatory.
6. Runtime is Vercel AI SDK.
7. Woops never manages OAuth.
8. Woops never manages Channels.
9. Woops never manages Integrations.
10. n8n owns all external systems.
11. Knowledge belongs to the Agent.
12. Memory belongs to the Agent.
13. Conversation is communication only.
14. Skills are reusable.
15. Runtime is replaceable.
16. Every important action emits a Domain Event.
17. Every Domain has a single responsibility.
18. Business Logic must never live inside the Runtime.
19. Agent intelligence must remain provider agnostic.
20. AI should orchestrate business capabilities, not infrastructure.
````
