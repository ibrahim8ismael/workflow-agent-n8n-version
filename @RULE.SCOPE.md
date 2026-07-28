---
tags:
  - woops
  - scope
  - development
aliases:
  - Development Scope
  - Current Scope
  - Allowed Work
---

# ⚠️ Current Development Scope

## Current Phase

The project is currently implementing **only the Woops Platform Backend (Control Plane).**

This repository represents the backend application responsible for all business logic.

---

## What You Are Allowed To Work On

You MUST only implement features that belong to the Woops Platform.

These include:

- Authentication
- Authorization
- Organizations
- Users
- Teams
- Billing
- Plans
- AI Agents
- Agent Runtime
- Conversations
- Memory
- Knowledge Base
- Channels
- Integrations
- Notifications
- Analytics
- Public APIs
- Internal Runtime Client
- Database
- Cache
- Queue
- Infrastructure Adapters

---

## What You MUST NOT Work On

This repository is **NOT** the Workflow Runtime.

Do NOT implement or modify anything related to:

- n8n Engine
- n8n Nodes
- n8n Editor
- n8n UI
- n8n Executions
- n8n Credentials
- n8n Internal Database
- n8n Workflow Builder
- n8n Runtime Logic
- n8n Worker
- n8n Packages

Those belong to a completely separate repository.

---

## Frontend Is Out Of Scope

Do NOT implement or modify:

- React Components
- Next.js Pages
- Dashboard UI
- Landing Pages
- Widget UI
- Frontend Hooks
- Frontend State Management
- CSS
- Tailwind
- Client-side Logic

The frontend lives in a different repository.

---

## Runtime Is Out Of Scope

The Runtime is an external service.

Assume it already exists.

The Platform communicates with it through REST APIs only.

Never implement runtime internals inside this repository.

---

## Repository Responsibility

This repository is responsible only for the **Woops Platform (Control Plane).**

It owns:

- Business Logic
- AI Orchestration
- Authentication
- Authorization
- Billing
- Organizations
- Agent Management
- Conversation Management
- Knowledge Management
- Memory Management
- Runtime Deployment Requests
- Runtime Execution Requests

---

## Repository Boundaries

```
                This Repository
        ┌─────────────────────────────┐
        │      WOOPS PLATFORM         │
        │                             │
        │ Authentication              │
        │ Billing                     │
        │ Organizations               │
        │ AI Agents                   │
        │ Conversations               │
        │ Memory                      │
        │ Knowledge                   │
        │ Integrations                │
        │ Runtime Client              │
        └──────────────┬──────────────┘
                       │
                 REST API Calls
                       │
                       ▼
        ┌─────────────────────────────┐
        │   Workflow Runtime (n8n)    │
        │     Separate Repository     │
        └─────────────────────────────┘
```

---

## AI Coding Agent Instructions

Before implementing any feature, ask yourself:

1. Does this feature belong to the Woops Platform?
2. Is this business logic?
3. Is this part of the Control Plane?
4. Would this still exist if the Runtime were replaced?

If the answer is **YES**, implement it here.

If the feature depends on the internal implementation of n8n or any frontend code, **do not implement it in this repository.**

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.ARCHITECTURE.md]] | [[@RULE.REPO_PATTERN.md]]

---

## Golden Rule

This repository must remain completely independent from:

- n8n
- Frontend
- Dashboard
- Widget
- Workflow Engine implementation

The Woops Platform should be able to switch from **n8n** to **Temporal**, **LangGraph**, or a custom runtime without requiring architectural changes to this repository.