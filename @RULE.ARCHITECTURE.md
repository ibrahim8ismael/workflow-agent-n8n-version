---
tags:
  - woops
  - architecture
  - engineering
aliases:
  - Architecture Rules
  - Platform Architecture
---

# WOOPS Platform Architecture
> System Architecture & Engineering Rules
>
> Version: 1.0
> Scope: Woops Platform (Control Plane)
>
> This document defines the architectural principles, system boundaries, dependency rules, and engineering standards for the Woops Platform.
>
> **This document does NOT apply to the Workflow Runtime (n8n).**

---

# 1. Architecture Philosophy

Woops is designed as a **Control Plane + Execution Plane** architecture.

The platform owns all business logic.

The runtime owns workflow execution.

Both systems are completely independent.

---

# Core Principle

The Platform decides **WHAT** should happen.

The Runtime decides **HOW** it happens.

Example

```
Customer sends message

↓

Platform

↓

AI decides to create invoice

↓

Platform calls Runtime

↓

Runtime executes workflow

↓

Platform receives result

↓

Platform responds to customer
```

The Runtime never makes business decisions.

---

# Architecture Style

The Platform follows a **Modular Monolith** architecture.

Reasons

- Easier development
- Easier debugging
- Easier deployment
- Lower operational complexity
- Strong module boundaries
- Easy future migration into microservices

The application must behave like independent services internally while remaining a single deployable application.

---

# High-Level Architecture

```
                    Client Applications
                           │
     ┌─────────────────────┼──────────────────────┐
     │                     │                      │
 Dashboard             Public API          Webhooks
     │                     │                      │
     └─────────────────────┼──────────────────────┘
                           │
                    WOOPS PLATFORM
                   (NestJS Backend)
                           │
 ┌──────────────────────────────────────────────────────────┐
  │ Authentication                                            │
  │ Authorization                                             │
  │ Organizations                                              │
  │ Agents                                                     │
  │ AI Runtime                                                 │
 │ Conversations                                              │
 │ Knowledge                                                  │
 │ Memory                                                     │
 │ Billing                                                    │
 │ Channels                                                   │
 │ Integrations                                               │
 │ Analytics                                                  │
 └──────────────────────────────────────────────────────────┘
                           │
                           │ Internal REST API
                           ▼
                  Workflow Runtime Service
                         (n8n)
                           │
                External APIs & Services
```

---

# Control Plane

The Platform is the Control Plane.

Responsibilities

- User Management
- Authentication
- Authorization
- Organizations
- Billing
- AI Agents
- Memory
- Knowledge
- Conversations
- Runtime Deployment
- Runtime Execution Requests
- Analytics
- Settings

Everything users see belongs here.

---

# Execution Plane

The Runtime is the Execution Plane.

Responsibilities

- Execute workflows
- Execute skills
- Retry failed jobs
- Execute scheduled jobs
- Webhooks
- Return execution results

The Runtime knows nothing about business logic.

---

# Runtime Boundary

The Runtime must remain replaceable.

Today

```
Woops Platform

↓

n8n Runtime
```

Tomorrow

```
Woops Platform

↓

Temporal
```

or

```
Woops Platform

↓

Custom Runtime
```

The Platform must never depend on runtime implementation details.

---

# Layered Architecture

```
Presentation Layer

↓

Application Layer

↓

Domain Layer

↓

Infrastructure Layer
```

Every request flows through these layers.

---

# Presentation Layer

Contains

- Controllers
- WebSockets
- DTOs
- Request Validation

Responsibilities

- Receive requests
- Validate requests
- Return responses

Forbidden

- Business Logic
- Database Queries

---

# Application Layer

Contains

- Services
- Use Cases
- Coordinators

Responsibilities

- Execute business rules
- Coordinate modules
- Handle transactions

This is where the majority of business logic lives.

---

# Domain Layer

Contains

- Entities
- Value Objects
- Domain Events
- Interfaces

Responsibilities

- Pure business concepts
- Domain rules
- Business invariants

The Domain Layer must never depend on NestJS, Prisma, Redis, or external services.

---

# Infrastructure Layer

Contains

- Prisma
- Redis
- Storage
- AI Providers
- Email Providers
- Runtime Client
- HTTP Clients
- Queue Workers

Responsibilities

- External communication
- Persistence
- Third-party integrations

Infrastructure must never contain business logic.

---

# Dependency Rule

Dependencies always point inward.

```
Controller

↓

Service

↓

Repository Interface

↓

Repository Implementation

↓

Database
```

Never reverse the dependency flow.

---

# Module Isolation

Each module owns:

- Controllers
- Services
- Repositories
- DTOs
- Events
- Validators
- Tests

Modules must not access another module's internal files.

Allowed

```
AgentService

↓

ConversationService
```

Forbidden

```
AgentRepository

↓

ConversationRepository
```

---

# Database Rule

Repositories are the only layer allowed to access Prisma.

Forbidden

```
Controller

↓

Prisma
```

Forbidden

```
Service

↓

Prisma
```

Allowed

```
Service

↓

Repository

↓

Prisma
```

---

# Business Logic Rule

Business logic belongs only inside Services.

Forbidden locations

- Controllers
- DTOs
- Validators
- Repositories
- Prisma
- Infrastructure
- Queue Workers

---

# External Services

Every external dependency must be abstracted.

Never call external SDKs directly from business modules.

Always use an adapter.

Example

```
AgentService

↓

AIProvider

↓

OpenAIAdapter
```

Never

```
AgentService

↓

OpenAI SDK
```

---

# Provider Pattern

Every provider must implement an interface.

Examples

```
AIProvider

StorageProvider

EmailProvider

RuntimeProvider

SearchProvider
```

Business modules depend only on interfaces.

---

# Runtime Communication

Communication with the Runtime must happen through a Runtime Client.

```
Agent Service

↓

Runtime Client

↓

REST API

↓

Runtime
```

No module may call the Runtime directly.

---

# Event-Driven Design

Modules should communicate using domain events when possible.

Examples

```
AgentCreated

ConversationStarted

KnowledgeIndexed

RuntimeDeploymentCompleted

SubscriptionUpgraded
```

Avoid tight coupling.

---

# Multi-Tenant Architecture

Everything belongs to an Organization.

Hierarchy

```
Organization

↓

Agent

↓

Conversation

↓

Messages
```

Every database query must be tenant-aware.

Cross-tenant access is forbidden.

---

# Authentication

Authentication exists only inside the Platform.

The Runtime never authenticates users.

Flow

```
User

↓

Platform Authentication

↓

JWT

↓

Platform Authorization

↓

Runtime Service Token

↓

Runtime
```

---

# Authorization

Authorization is evaluated before business logic executes.

Rules

- RBAC
- Organization Scope
- Resource Ownership

Never trust client-provided permissions.

---

# AI Runtime

The AI Runtime belongs to the Platform.

Responsibilities

- Prompt Assembly
- Memory Retrieval
- Knowledge Retrieval
- Planning
- Skill Selection
- Tool Selection
- Context Management

The Workflow Runtime executes only the selected skill.

---

# Transactions

Business operations involving multiple writes must use database transactions.

Examples

- Organization creation
- Billing
- User invitations
- Agent publishing

---

# Error Handling

Errors must be standardized.

Every API returns

```
Success

or

Failure
```

Never expose stack traces.

---

# Logging

Every request must have

- Request ID
- Correlation ID
- User ID
- Organization ID

Logs must be structured JSON.

---

# Validation

Validate

- Request
- Environment
- Business Rules

Never trust user input.

---

# Caching

Redis is an optimization layer.

Redis must never become the source of truth.

The database remains authoritative.

---

# Queue Rules

Queues execute asynchronous work only.

Examples

- Email
- Embeddings
- Notifications
- Runtime Deployment
- AI Processing

Queue workers must not contain business logic.

They invoke application services.

---

# API Design

APIs must be

- RESTful
- Versioned
- Stateless
- Predictable

Every endpoint belongs to exactly one module.

---

# Clean Code Rules

Always

- Small services
- Single responsibility
- Constructor injection
- Composition over inheritance
- Immutable DTOs
- Explicit types

Never

- Use `any`
- Create God Services
- Duplicate business logic
- Access another module's database

---

# Scalability Strategy

The architecture must support future extraction into microservices.

Every module should be independently extractable without rewriting business logic.

Module boundaries today become service boundaries tomorrow.

---

# Engineering Principles

Follow

- SOLID
- Clean Architecture
- Dependency Injection
- Repository Pattern
- Adapter Pattern
- Factory Pattern
- Strategy Pattern
- Domain-Oriented Design
- Feature-First Organization

---

# Architectural Decision Record

The following decisions are considered permanent unless explicitly replaced by a new ADR.

- The Platform is a Modular Monolith.
- The Runtime is an independent service.
- The Platform owns all business logic.
- The Runtime owns workflow execution only.
- All external systems are accessed through adapters.
- Business modules never depend on infrastructure implementations.
- Every resource is tenant-aware.
- Every module is independently maintainable.
- Runtime implementations are replaceable.
- The Platform remains runtime-agnostic.

## ADR-011 — Automations live in client-provided n8n instances

**Decision (2026-08):** Jaafar designs automations; the user explicitly
approves; the platform provisions the workflow into the **client's own n8n
instance** (API-key connected, encrypted at rest). Agent runs execute through
the client's webhooks. The Employee Design flow and the Skills system are
removed; the platform does not require a platform-owned n8n for customer
automations. See [[@RULE.AUTOMATIONS.md]] and
@PLAN.N8N.CLIENT.MODE.md.

**Consequences:** client API keys are platform-held secrets (AES-256-GCM);
the SSRF guard applies to every client `baseUrl`; provisioning is reachable
only behind the approval gate; the legacy env-global n8n path is deprecated
(dual-read until the cutover completes).

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.REPO_PATTERN.md]] | [[@RULE.SCOPE.md]] | [[@RULE.CODEBASE.md]]

---

# Final Principle

The Woops Platform is the **brain** of the system.

It owns every business decision, every AI decision, every security decision, and every customer interaction.

The Workflow Runtime is simply an execution engine.

At no point should business logic leak into the Runtime, and at no point should the Platform depend on the internal implementation of the Runtime.