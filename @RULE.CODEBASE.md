---
tags:
  - woops
  - codebase
  - engineering
aliases:
  - Codebase Rules
  - Coding Standards
  - Engineering Principles
---

# WOOPS Platform — Codebase Rules
> Coding Standards, Engineering Principles & Implementation Guidelines
>
> Version: 1.0
> Scope: Woops Platform Backend (Control Plane)
>
> This document defines how code must be written inside the Woops Platform backend.
>
> These are mandatory engineering rules for every developer and every AI Coding Agent.
>
> **These rules apply ONLY to the Woops Platform Backend.**
>
> **Do NOT apply these rules to the Workflow Runtime (n8n) or the Frontend.**

---

# Current Scope

The AI Coding Agent is currently working only on the **Woops Platform Backend**.

Allowed:

- Business Logic
- Authentication
- Authorization
- Organizations
- Users
- Agents
- Billing
- Conversations
- Memory
- Knowledge
- Runtime Client
- Database
- Infrastructure

Out of scope:

- n8n Runtime
- Frontend
- React
- Next.js
- Workflow Execution Engine

---

# Engineering Philosophy

Every line of code should be

- Simple
- Readable
- Testable
- Modular
- Predictable
- Maintainable
- Replaceable

The codebase is expected to live for many years.

Always optimize for maintainability over cleverness.

---

# Core Principles

Always follow

- SOLID
- DRY
- KISS
- Clean Architecture
- Feature-First Organization
- Dependency Injection
- Composition over Inheritance
- Explicit over Implicit

---

# Single Responsibility Principle

Each class should have one reason to change.

Bad

```
AgentService

- Authentication
- Billing
- AI
- Database
- Notifications
```

Good

```
AgentService

↓

AgentRepository

↓

NotificationService

↓

RuntimeService
```

---

# Keep Files Small

Target

- Service < 300 lines
- Controller < 150 lines
- Repository < 250 lines

If a file grows too large, split it.

---

# Function Rules

Functions should

- Do one thing
- Have descriptive names
- Return predictable values
- Avoid side effects

Avoid functions longer than 50 lines.

---

# Naming

Classes

```
PascalCase
```

Interfaces

```
PascalCase
```

Files

```
kebab-case
```

Folders

```
kebab-case
```

Variables

```
camelCase
```

Constants

```
UPPER_SNAKE_CASE
```

Enums

```
PascalCase
```

---

# TypeScript Rules

Always use strict typing.

Never disable strict mode.

Never use

```
any
```

Prefer

```
unknown
```

or explicit interfaces.

Avoid unnecessary type assertions (`as`) unless absolutely required.

---

# DTO Rules

DTOs define API contracts only.

DTOs must

- Validate input
- Describe requests
- Describe responses

DTOs must never contain business logic.

---

# Controller Rules

Controllers are thin.

Controllers should only

- Receive requests
- Validate input
- Call services
- Return responses

Controllers must never

- Access Prisma
- Call external APIs
- Execute business logic

---

# Service Rules

Services contain business logic.

Services may call

- Repositories
- Other Services
- Infrastructure Adapters

Services must never access Prisma directly.

---

# Repository Rules

Repositories are responsible only for persistence.

Repositories may

- Query
- Create
- Update
- Delete (Soft Delete)

Repositories must never

- Validate business rules
- Send emails
- Call APIs
- Execute AI logic

---

# Validation Rules

Validate as early as possible.

Use Zod for validation.

Validate

- Requests
- Configuration
- External payloads

Never trust external input.

---

# Error Handling

Throw domain-specific exceptions.

Never expose raw errors.

Every error should be

- Predictable
- Logged
- Traceable

---

# Logging

Use structured logging only.

Every log should include when applicable

- Request ID
- User ID
- Organization ID
- Agent ID
- Correlation ID

Never log

- Passwords
- Tokens
- Secrets
- Personal data

---

# Dependency Injection

Always use NestJS Dependency Injection.

Never manually instantiate services.

Bad

```ts
const service = new AgentService();
```

Good

```ts
constructor(private readonly agentService: AgentService) {}
```

---

# Interfaces First

Depend on abstractions.

Bad

```
AgentService

↓

OpenAIAdapter
```

Good

```
AgentService

↓

AIProvider

↓

OpenAIAdapter
```

---

# External Services

Never call external SDKs directly from modules.

Always create adapters.

Examples

- OpenAI
- Gemini
- Redis
- AWS
- Stripe
- Runtime

---

# Business Logic

Business rules belong only inside Services.

Forbidden locations

- Controllers
- Repositories
- DTOs
- Middleware
- Guards
- Infrastructure

---

# Async Code

Always use async/await.

Avoid nested promises.

Handle errors explicitly.

---

# Magic Values

Never hardcode values.

Bad

```ts
if (plan === 2)
```

Good

```ts
if (plan === SubscriptionPlan.PRO)
```

---

# Environment Variables

Never access

```
process.env
```

inside business code.

Use configuration services.

---

# Comments

Write self-explanatory code.

Comments should explain **why**, not **what**.

Bad

```ts
// Increment i
i++;
```

Good

```ts
// Retry after provider rate limiting
```

---

# Code Duplication

Never duplicate business logic.

Extract shared behavior into

- Services
- Helpers
- Value Objects
- Utilities

---

# Null Safety

Always handle

- null
- undefined
- optional values

Avoid runtime exceptions.

---

# API Responses

Responses must be consistent across the platform.

Never return raw database objects.

Always map entities to response DTOs.

---

# Database Access

Business modules never access Prisma directly.

Always

```
Service

↓

Repository

↓

Prisma
```

---

# Transactions

Use transactions when multiple writes are required.

Never leave partially completed operations.

---

# Events

Prefer domain events for cross-module communication.

Avoid tightly coupling modules.

---

# Configuration

Every configurable value belongs in configuration.

Never hardcode

- URLs
- API Keys
- Secrets
- Limits
- Timeouts

---

# Security

Never

- Log secrets
- Store plain passwords
- Trust client input
- Expose internal stack traces

Use

- Argon2
- JWT
- Encryption
- Validation

---

# Performance

Avoid

- N+1 queries
- Blocking operations
- Large object creation
- Unbounded loops

Optimize only after measuring.

---

# Testing

Every new feature should include tests.

Prefer

- Unit Tests
- Integration Tests

Business logic should be testable without external services.

---

# AI Coding Rules

Before writing code, verify:

- Does this belong to the Platform?
- Is there already a service that should own this logic?
- Can this be reused?
- Does it follow the existing architecture?
- Is it testable?
- Is it modular?

If the answer is **No**, redesign before implementing.

---

# Forbidden Practices

Never

- Use `any`
- Bypass repositories
- Put business logic in controllers
- Hardcode secrets
- Duplicate logic
- Create circular dependencies
- Couple business modules to infrastructure
- Modify generated Prisma files
- Mix platform logic with runtime logic
- Mix backend logic with frontend concerns

---

# Code Review Checklist

Before completing any implementation, ensure:

- Follows repository structure.
- Uses dependency injection.
- Respects module boundaries.
- Uses repositories for persistence.
- Uses DTOs for API contracts.
- Uses adapters for external services.
- Includes validation.
- Includes error handling.
- Includes logging where appropriate.
- Uses explicit types.
- Avoids duplicated logic.
- Preserves tenant isolation.
- Remains independent of the Workflow Runtime.

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.REPO_PATTERN.md]] | [[@RULE.ARCHITECTURE.md]]

---

# Final Rule

The Woops Platform codebase must remain clean, modular, and independent.

Every feature should be implemented in a way that allows the platform to evolve, scale, and replace external dependencies—including the Workflow Runtime—without requiring changes to the core business logic.