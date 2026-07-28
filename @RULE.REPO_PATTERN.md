---
tags:
  - woops
  - repository
  - structure
aliases:
  - Repo Pattern
  - Folder Rules
  - Module Structure
---

# WOOPS Platform — Repository Structure & Folder Rules
> Architecture Standards for the Woops Platform (Agent Layer)
>
> **Version:** 1.0
> **Scope:** Woops Platform Only
>
> This document defines the repository structure, folder organization, module boundaries, and architectural rules for the **Woops Platform**.
>
> **It does NOT apply to the Workflow Runtime (n8n).**

---

# Philosophy

The Woops Platform is the **Control Plane** of the entire system.

It is responsible for:

- Authentication
- Authorization
- Organizations
- Billing
- AI Agents
- Conversations
- Memory
- Knowledge
- Integrations
- AI Runtime
- Analytics

It is **NOT** responsible for executing workflows.

Workflow execution belongs to the Runtime service.

---

# Repository Structure

```
woops-platform/

├── src/
├── prisma/
├── test/
├── docs/
├── scripts/
├── docker/
├── public/
├── .github/
├── package.json
├── tsconfig.json
└── README.md
```

---

# Source Structure

```
src/

├── app.module.ts
├── main.ts

├── modules/
├── common/
├── infrastructure/
├── config/
├── database/
├── shared/
└── types/
```

---

# Layer Responsibilities

```
src/

modules/
        Business Features

common/
        Shared framework utilities

shared/
        Shared domain utilities

infrastructure/
        External services

config/
        Configuration

database/
        Prisma

types/
        Global typings
```

---

# Modules Folder

Every business feature belongs inside

```
src/modules/
```

Example

```
modules/

auth/

users/

organizations/

agents/

conversations/

knowledge/

memory/

billing/

runtime/

channels/

integrations/

notifications/

analytics/
```

Every module must be isolated.

Modules communicate through services/events only.

Never import internal files directly.

---

# Standard Module Structure

Every module must follow exactly this layout.

```
agents/

controllers/

services/

repositories/

dto/

entities/

interfaces/

schemas/

validators/

constants/

events/

mappers/

types/

guards/

decorators/

tests/

agent.module.ts
```

Folders that are not used may be omitted.

Never invent custom folder structures.

---

# Controllers

Responsibilities

- Receive HTTP requests
- Validate input
- Call Services
- Return responses

Controllers must never contain business logic.

---

# Services

Services contain all business logic.

A service may call

- Repository
- External Adapter
- Other Services

A service must never call Prisma directly.

---

# Repositories

Repositories are the only layer allowed to access Prisma.

Responsibilities

- Database Queries
- Transactions
- Persistence

Business logic is forbidden.

---

# DTO

DTOs define

- Request payloads
- Response payloads

Validation is handled using Zod.

---

# Entities

Entities represent domain models.

Entities are not Prisma models.

Keep them independent from persistence.

---

# Interfaces

Contains

- Contracts
- Service interfaces
- Repository interfaces

Never depend on implementations.

---

# Validators

Contains

- Zod Schemas
- Input Validation
- Business Validation

---

# Constants

Contains

- Enums
- Static values
- Limits
- Configuration constants

---

# Events

Contains

Domain Events only.

Examples

```
AgentCreated

ConversationStarted

KnowledgeIndexed

MessageReceived
```

---

# Mappers

Responsible for converting between

DTO

↓

Entity

↓

Persistence

↓

API

Never mix mapping inside services.

---

# Types

Module-specific TypeScript types.

---

# Guards

Authorization logic only.

---

# Decorators

NestJS custom decorators.

---

# Tests

Each module owns its tests.

```
tests/

unit/

integration/
```

---

# Infrastructure Layer

```
src/infrastructure/
```

Contains every external dependency.

```
infrastructure/

ai/

storage/

email/

runtime/

cache/

queue/

search/

http/
```

Infrastructure never contains business logic.

---

# AI

```
infrastructure/ai/
```

```
providers/

openai/

gemini/

anthropic/

ollama/

azure/

openrouter/

interfaces/

factory/

adapters/
```

Everything must implement

```
AIProvider
```

No module may call OpenAI directly.

---

# Runtime

```
infrastructure/runtime/
```

Contains

- Runtime Client
- Runtime API
- Deployment
- Execution Client

Never execute workflows here.

This layer communicates only with the Runtime Service.

---

# Storage

```
storage/

providers/

s3/

r2/

minio/

bunny/
```

Every provider implements

```
StorageProvider
```

---

# Email

```
email/

providers/

resend/

ses/

mailgun/
```

Every provider implements

```
EmailProvider
```

---

# Queue

```
queue/

workers/

producers/

jobs/
```

No business logic.

---

# Shared Layer

```
src/shared/
```

Contains reusable code shared across modules.

Examples

```
shared/

errors/

value-objects/

helpers/

utils/

events/

contracts/

responses/
```

Shared must never depend on modules.

---

# Common Layer

```
src/common/
```

Contains framework-related utilities.

Examples

```
guards/

pipes/

filters/

decorators/

interceptors/

middlewares/

exceptions/

logger/
```

---

# Config

```
config/

database/

redis/

runtime/

storage/

email/

jwt/

ai/

billing/
```

Every config validates environment variables.

---

# Database

```
database/

prisma/

extensions/

middlewares/

seed/
```

Prisma exists only here.

Never expose Prisma outside repositories.

---

# Naming Rules

Folders

```
kebab-case
```

Files

```
kebab-case
```

Classes

```
PascalCase
```

Interfaces

```
PascalCase
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

# Dependency Rules

Allowed

```
Controller

↓

Service

↓

Repository

↓

Prisma
```

Forbidden

```
Controller

↓

Prisma
```

Forbidden

```
Controller

↓

Repository
```

Forbidden

```
Repository

↓

Service
```

Forbidden

```
Infrastructure

↓

Modules
```

Infrastructure must remain independent.

---

# Module Communication

Preferred

```
Service

↓

Service
```

Large features

```
Domain Events
```

Never import another module's repository.

---

# Runtime Boundary

The Runtime is an external service.

Communication

```
Platform

↓

Runtime Client

↓

REST API

↓

Runtime Service
```

The platform never knows how workflows execute.

The runtime never knows platform business logic.

---

# Business Rules

Business logic belongs only inside Services.

Never inside

- Controllers
- Repositories
- Prisma
- Adapters
- Infrastructure
- DTOs

---

# Architectural Principles

Follow

- Clean Architecture
- SOLID
- Dependency Injection
- Repository Pattern
- Adapter Pattern
- Factory Pattern
- Strategy Pattern
- Domain-Oriented Design
- Feature-First Organization

---

# Folder Rules

Every new feature must:

- Create its own module.
- Own its controllers.
- Own its services.
- Own its repositories.
- Own its DTOs.
- Own its tests.
- Never leak implementation details.
- Never access another module's database layer directly.

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.ARCHITECTURE.md]] | [[@RULE.CODEBASE.md]]

---

# Final Rule

The Woops Platform is the **brain** of the system.

It owns the business rules, AI orchestration, security, billing, and user experience.

Everything related to workflow execution is delegated to the external Runtime service through a stable API contract.

The Platform should always remain independent of the implementation details of any workflow engine, ensuring that the runtime can evolve or be replaced without impacting the platform's architecture.