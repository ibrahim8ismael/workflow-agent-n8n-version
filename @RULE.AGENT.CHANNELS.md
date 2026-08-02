````md
# AI Agent Architecture Rules
> Woops Engineering Standard
> Version: 1.0
> Status: Official Architecture Rules

---

# Purpose

This document defines the mandatory architectural rules for the Woops AI Agent Platform.

These rules are considered **non-negotiable** and every implementation inside the AI Core MUST follow them.

If implementation and this document conflict,
this document always wins.

---

# Rule 1 — Agent is an AI Employee

The Agent is NOT:

- A Prompt
- A Workflow
- A Chatbot
- A Model Wrapper

The Agent represents an intelligent AI Employee.

Every Agent has:

- Identity
- Purpose
- Instructions
- Configuration
- Skills
- Knowledge
- Memory
- Planning Rules
- Runtime Configuration

---

# Rule 2 — Agent is the Brain

The Agent never executes infrastructure.

The Agent only decides.

Responsibilities:

- Understand Goal
- Generate Plan
- Select Skills
- Build Context
- Coordinate Execution
- Produce Response

---

# Rule 3 — Workflow is Renamed to Skill

The word Workflow is forbidden inside the AI Domain.

Use

```
Skill
```

Reason

Employees have Skills.

Not Workflows.

Examples

```
HR Agent

Skills

- Employee Lookup
- Leave Approval
- Recruitment
- Payroll
```

```
Sales Agent

Skills

- CRM Lookup
- Lead Qualification
- Opportunity Creation
- Meeting Scheduling
```

---

# Rule 4 — Skills are Business Capabilities

A Skill represents one business capability.

Examples

- Search CRM
- Create Invoice
- Schedule Meeting
- Generate Proposal
- Send Offer

A Skill may internally

- Call AI
- Execute n8n
- Call API
- Use Memory
- Use Knowledge

The Agent never knows how.

---

# Rule 5 — Every Execution Creates One Run

Every execution starts a new Run.

Examples

- User Message
- API Request
- Scheduler
- Retry
- Resume

Each creates

```
Run
```

No exceptions.

---

# Rule 6 — Planning is Mandatory

The Agent never executes immediately.

Execution always starts with Planning.

Flow

```
Understand Goal

↓

Generate Plan

↓

Validate Plan

↓

Execute Plan
```

Skipping planning is forbidden.

---

# Rule 7 — Plan Before Execute

Execution without a Plan is prohibited.

Every Plan defines

- Goal
- Skills
- Dependencies
- Execution Order
- Success Criteria
- Required Inputs

---

# Rule 8 — Missing Information Must Be Requested

If the Agent cannot safely execute a Skill

It MUST ask the user.

Never guess.

Never hallucinate missing business information.

---

# Rule 9 — Agent Owns Skills

The Agent owns

- Skill Definitions
- Skill Selection
- Skill Priority
- Skill Permissions

The Runtime executes them.

---

# Rule 10 — Agent Owns Knowledge

Knowledge belongs to the Agent.

Never to

- Runtime
- Conversation
- Run

Knowledge sources may include

- PDF
- Website
- FAQ
- Documentation
- Database
- API
- Notion

---

# Rule 11 — Agent Owns Memory

Memory belongs to the Agent.

Not Runtime.

Memory survives Runs.

Runs never own Memory.

---

# Rule 12 — Conversation is Communication Only

Conversation stores

- Messages
- Attachments
- Participants
- Timeline

Conversation never contains

- Planning
- Knowledge
- Memory
- Skills

---

# Rule 13 — Run Owns Execution

Run owns

- State
- Events
- Usage
- Cost
- Duration
- Skill Executions

Run never owns

- Memory
- Knowledge
- Conversation

---

# Rule 14 — Runtime is Replaceable

The Runtime is infrastructure.

Current Runtime

```
Vercel AI SDK
```

The Runtime must always be replaceable.

Business Logic must never depend on Runtime implementation.

---

# Rule 15 — Vercel AI SDK Responsibilities

Vercel AI SDK owns

- Streaming
- Provider SDKs
- Tool Calling
- Structured Outputs
- Model Communication

Woops does NOT implement those features.

---

# Rule 16 — Woops Responsibilities

Woops owns

- Agent
- Planner
- Plan
- Run
- Memory
- Knowledge
- Conversation
- Context
- Skill Orchestration

Woops does NOT own

- OAuth
- Channels
- Integrations
- External Credentials

---

# Rule 17 — n8n Responsibilities

n8n owns

- OAuth
- Refresh Tokens
- Access Tokens
- API Keys
- Integrations
- Channels
- Workflow Execution
- Automation
- Scheduling
- Triggers

Woops never manages these.

---

# Rule 18 — OAuth Boundary

The Agent never performs OAuth.

Instead

```
Is Integration Connected?
```

If YES

↓

Execute Skill

If NO

↓

Ask User To Connect

---

# Rule 19 — Channel Boundary

The Agent never sends messages directly.

The Agent asks

```
Is Channel Available?
```

If available

↓

Execute Skill

Otherwise

↓

Return proper response.

The Agent never manages

- WhatsApp
- Messenger
- Slack
- Telegram
- Email

Those belong to n8n.

---

# Rule 20 — Integration Boundary

The Agent never knows

- API Keys
- Tokens
- Secrets
- OAuth
- REST Clients

Skills abstract all integrations.

---

# Rule 21 — Context is Dynamic

Every Run builds a fresh Context.

Context consists of

- System Rules
- Agent Instructions
- Skill Instructions
- Conversation
- Memory
- Knowledge
- User Input

Context is never stored.

It is rebuilt every Run.

---

# Rule 22 — Context Must Be Optimized

Never send

- Entire Conversation
- Entire Memory
- Entire Knowledge Base

Always retrieve only relevant information.

---

# Rule 23 — Memory Rules

Memory stores

- User Preferences
- Business Facts
- Learned Information

Memory never stores

- Secrets
- OAuth Tokens
- Passwords
- API Keys

---

# Rule 24 — Knowledge Rules

Knowledge is

Read Only

during execution.

Knowledge updates happen outside Runs.

---

# Rule 25 — Skills May Use n8n

Example

```
Payroll Skill

↓

Execute n8n

↓

SAP

↓

Result

↓

Continue
```

The Agent never knows SAP exists.

---

# Rule 26 — Skills Must Be Reusable

A Skill should never depend on a specific Agent.

Skills must be reusable across Agents.

---

# Rule 27 — Every Important Action Emits Events

Examples

- AgentCreated
- RunStarted
- PlanGenerated
- SkillStarted
- SkillCompleted
- MemoryStored
- KnowledgeRetrieved
- ResponseGenerated
- RunCompleted

Events are immutable.

---

# Rule 28 — Every Domain Owns Its Logic

Business logic must stay inside its Domain.

Never duplicate logic.

---

# Rule 29 — Single Responsibility

Each Domain has exactly one responsibility.

Agent

↓

AI Employee

Run

↓

Execution

Conversation

↓

Communication

Knowledge

↓

Business Information

Memory

↓

Long-Term Intelligence

Skill

↓

Business Capability

Runtime

↓

Execution Infrastructure

---

# Rule 30 — AI Provider Independence

The Agent never knows

- OpenAI
- Anthropic
- Gemini
- Groq

Providers are Runtime concerns.

---

# Rule 31 — Future Compatibility

Every design decision must support

- Multi-Agent
- Human Approval
- Background Runs
- Voice
- Vision
- Agent Marketplace
- Skill Marketplace
- Multiple AI Providers

without changing the Agent Domain.

---

# Rule 32 — Golden Architecture

```
                 User
                   │
                   ▼
            Conversation
                   │
                   ▼
                Agent
                   │
         ┌─────────┼─────────┐
         │         │         │
         ▼         ▼         ▼
     Knowledge   Memory    Skills
         │         │         │
         └─────────┼─────────┘
                   ▼
               Planner
                   │
                   ▼
                  Plan
                   │
                   ▼
                   Run
                   │
                   ▼
            Context Builder
                   │
                   ▼
            Vercel AI SDK
                   │
                   ▼
                 n8n
                   │
                   ▼
         External Systems
```

---

# Final Principles

1. Agent is an AI Employee.
2. Workflow is renamed to Skill.
3. Every request creates one Run.
4. Every Run starts with Planning.
5. Every Plan executes Skills.
6. Skills encapsulate business capabilities.
7. Vercel AI SDK is the Runtime.
8. Runtime is infrastructure only.
9. n8n owns integrations.
10. n8n owns channels.
11. n8n owns OAuth.
12. Agent owns Knowledge.
13. Agent owns Memory.
14. Conversation owns communication.
15. Run owns execution.
16. Context is rebuilt every execution.
17. Skills must be reusable.
18. Business logic never depends on infrastructure.
19. Domains must remain independent.
20. AI orchestrates business capabilities—not infrastructure.
````
