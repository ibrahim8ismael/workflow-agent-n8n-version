---
tags:
  - woops
  - mother-document
  - business-model
aliases:
  - Business Model
  - Mother Document
  - Woops Business Model
---

# Woops — Complete Business Model
> Master Product & Business Documentation (Version 2.0)
>
> This is the **mother document**. Every other `@RULE.*.md` file derives from here.
>
> Connected documents:
> - [[@RULE.USERS.md]] — Identity, ownership, roles & permissions
> - [[@RULE.ARCHITECTURE.md]] — System architecture & engineering rules
> - [[@RULE.REPO_PATTERN.md]] — Repository structure & folder rules
> - [[@RULE.SCOPE.md]] — Current development scope
> - [[@RULE.DB.md]] — Database standards & persistence rules
> - [[@RULE.API.md]] — REST API design & endpoint rules
> - [[@RULE.CODEBASE.md]] — Coding standards & implementation guidelines

---

# 1. Project Identity

## Project Name

**Woops**

## Category

AI Agent Platform

## Vision

Build the operating system for business AI agents.

Woops enables companies to build, deploy, manage, and scale AI agents that automate customer communication, business operations, and internal workflows without requiring complex AI infrastructure.

---

# 2. Mission & Philosophy

## Mission

Allow any business to create production-ready AI agents in minutes instead of months.

Businesses should never need to understand LLMs, prompts, RAG pipelines, vector databases, automation engines, or infrastructure. Woops abstracts all of that behind a simple visual platform.

## Core Philosophy

Woops is **NOT** a chatbot builder.
Woops is **NOT** an automation platform.
Woops is **NOT** a workflow builder.

Woops is an **AI Agent Platform**.

Automation is only one capability of an AI Agent.

## Product Position

| Platform | Domain |
|----------|--------|
| Shopify  | Websites |
| Figma    | Design |
| Notion   | Knowledge |
| **Woops** | **AI Agents** |

## Core Value Proposition

1. Businesses describe what they need.
2. Woops builds the AI Agent.
3. The business configures it.
4. The AI Agent works.

---

# 3. System Architecture

The platform is divided into **two independent systems**.

See [[@RULE.ARCHITECTURE.md]] for full architecture details.

## 3.1 Woops Platform (Control Plane)

Responsible for all business logic, authentication, authorization, AI orchestration, and customer experience.

### Responsibilities

- Authentication & Authorization
- Organizations & Users
- AI Agents & AI Runtime
- Conversations, Memory, Knowledge
- Channels & Integrations
- Billing & Analytics
- Runtime orchestration

### Technology

| Component | Choice |
|-----------|--------|
| Framework | NestJS |
| Language  | TypeScript (strict) |
| Database  | PostgreSQL 16+ via Prisma ORM |
| Cache     | Redis (optimization only) |
| Queue     | Bull/BullMQ |

## 3.2 Workflow Runtime (Execution Plane)

Responsible only for executing workflows, skills, and background jobs.

### Responsibilities

- Execute workflows & skills
- Retry, scheduling, webhooks
- Background execution

### Design Constraint

The Runtime must remain **replaceable**. Today it is n8n. Tomorrow it could be Temporal, LangGraph, or a custom engine.

See [[@RULE.ARCHITECTURE.md#Runtime Boundary]].

---

# 4. Identity & Ownership Model

See [[@RULE.USERS.md]] for complete identity rules.

## 4.1 Identity Types

Woops supports exactly **three identity roles**:

```
System Administrator
        ↓
    Organization
        ↓
       User
```

No other identity types exist. No Workspace entity exists.

## 4.2 System Administrator

Belongs to Woops (not to any customer).

**Can:** View all orgs/users, suspend orgs/users, manage subscriptions, issue refunds, manage feature flags, analytics, global settings, system logs, admin dashboard, AI providers, platform integrations.

**Cannot:** Automatically become a member of customer organizations. Must use audited impersonation for support access.

See [[@RULE.USERS.md#1-system-administrator]].

## 4.3 User (Individual Account)

An individual customer who owns their own resources. Not part of an organization unless explicitly invited.

**Can:** Create AI Agents, upload Knowledge, store Memory, connect Integrations, manage Billing, use APIs, create Conversations, use Channels.

**Ownership chain:**
```
User → Agent → Knowledge → Memory → Conversation → Integration
```

See [[@RULE.USERS.md#2-user-individual-account]].

## 4.4 Organization

Represents a company or business. Owns all shared business resources.

**Can:** Invite/remove users, assign roles, own agents, knowledge bases, integrations, billing, conversations, channels, API keys.

**Ownership chain:**
```
Organization → Agents → Knowledge → Memory → Integrations → Conversations
```

See [[@RULE.USERS.md#3-organization]].

## 4.5 Organization Membership & Roles

Users become members only through invitation.

| Role   | Permissions |
|--------|-------------|
| Owner  | Delete org, manage billing, invite/remove members, assign roles, manage API keys, agents, integrations |
| Admin  | Invite/remove users, manage agents, knowledge, conversations, integrations |
| Member | Use assigned agents, create conversations, upload knowledge (if permitted) |
| Viewer | Read-only: view dashboards, conversations, reports |

Every organization must always have at least one Owner.

## 4.6 Ownership Rules

- Every business resource must have exactly **one** owner.
- Owner can be a **User** or an **Organization** — never both.
- Same rule applies to: Knowledge, Memory, Integrations, Conversations, Billing.

## 4.7 Acting Context

A user always operates in exactly one context:
- **Individual Mode** — personal resources
- **Organization Mode** — shared business resources

The active context determines visible agents, billing, conversations, integrations, and permissions.

---

# 5. AI Agent Model

## 5.1 AI Agent

The AI Agent is the **primary product object**. Everything else exists only to support it.

An AI Agent contains:
- Name, Description, Instructions, Personality
- AI Model selection
- Memory (Short-term, Long-term, Business)
- Knowledge sources
- Skills & Tools
- Channels
- Permissions & Variables
- Runtime Configuration

## 5.2 Skills

Skills define what an AI Agent can do. Examples:
- Book appointments, Send emails, Create invoices
- Update CRM, Generate reports, Answer questions
- Search documents, Analyze images, Execute workflows

Skills are internally executed by the Workflow Runtime.

## 5.3 Tools

A Skill may use one or more tools:
- HTTP APIs, Database, Google Calendar, Gmail
- Slack, Stripe, Shopify, WhatsApp, Custom APIs

## 5.4 Knowledge

Knowledge gives an AI Agent information. Sources:
- PDFs, DOCX, Websites, Notion, FAQ
- Markdown, Manual text, Product catalogs, APIs

Knowledge is indexed and searchable.

## 5.5 Memory

| Type | Purpose |
|------|---------|
| Short-Term | Conversation context |
| Long-Term | Persistent user information |
| Business | Organization-specific information |

## 5.6 Channels

Agents communicate through multiple channels:
- Website Widget, WhatsApp, Facebook Messenger, Instagram
- Telegram, Email, Slack, Discord, API, Voice (Future)

## 5.7 Deployment Pipeline

```
Agent → Validation → Compilation → Workflow Package → Deployment → Runtime
```

---

# 6. Multi-Tenant Architecture

Every resource belongs to an **Organization**. No customer data is shared across organizations.

## Hierarchy

```
Organization
     ↓
   Agent
     ↓
Conversation
     ↓
  Messages
```

**No Workspace entity exists.** The tenant hierarchy is flat: Organization → Agent.

## Tenant Types

- Individual User
- Organization

There are no nested tenants. See [[@RULE.DB.md#Multi-Tenant Rules]].

## Isolation Rules

- Every database query must be tenant-aware.
- Cross-tenant access is forbidden.
- No organization may access another organization's data.
- Individual users own only their own resources.

---

# 7. Authentication & Authorization

## 7.1 Authentication Flow

See [[@RULE.API.md#Authentication]].

```
User → Platform Authentication → JWT → Platform Authorization → Runtime Service Token → Runtime
```

Authentication identifies the identity. It does **not** grant permissions.

## 7.2 Authorization

Every request must determine:
1. Who is the user?
2. Is the user a System Administrator?
3. Is the user acting as an Individual?
4. Is the user acting inside an Organization?
5. What role do they have?
6. Do they have permission?

**Never trust client-provided roles or organization IDs.**

## 7.3 Permission Hierarchy

```
System Administrator
        ↓
  Organization Owner
        ↓
 Organization Admin
        ↓
 Organization Member
        ↓
 Organization Viewer
```

Higher roles inherit lower-level permissions unless explicitly restricted.

## 7.4 System Administrator Override

System Administrators access customer resources only through an audited impersonation flow. Every impersonation records: Administrator ID, Target User/Organization, Timestamp, Reason, IP Address.

---

# 8. Database Model

See [[@RULE.DB.md]] for complete database rules.

## Core Entities

```
User ↔ OrganizationMember → Organization
```

## Technology

| Component | Choice |
|-----------|--------|
| Database  | PostgreSQL 16+ |
| ORM       | Prisma ORM |
| Pool      | Prisma Accelerate (Future) |

## Schema Rules

- **Primary Keys:** UUID v7, no auto-increment
- **Audit Fields:** `id`, `createdAt`, `updatedAt`, `deletedAt` on every business table
- **Soft Delete:** Default. `deletedAt IS NULL` is the default filter
- **Naming:** Tables `snake_case`, Columns `camelCase`, Models `PascalCase`
- **Foreign Keys:** Always use foreign keys, always indexed
- **JSONB:** Only for dynamic structures (providerConfig, metadata, runtimeConfig, settings)

## Ownership Implementation

Business entities support ownership without duplicating logic:
```
Agent {
  organizationId?  // Exactly one must be populated
  userId?          // Exactly one must be populated
}
```

## Key Constraints

- `User.email` — unique
- `Organization.slug` — unique
- `ApiKey.key` — unique
- `Subscription.providerSubscriptionId` — unique

---

# 9. API Design

See [[@RULE.API.md]] for complete API standards.

## Style

RESTful, versioned (`/api/v1/`), stateless, resource-oriented.

## Resource Naming

Plural resource names:
```
GET /api/v1/agents
GET /api/v1/agents/{id}
POST /api/v1/agents
PATCH /api/v1/agents/{id}
DELETE /api/v1/agents/{id}
```

## Response Format

**Success:**
```json
{ "success": true, "data": {}, "meta": {} }
```

**Error:**
```json
{ "success": false, "error": { "code": "RESOURCE_NOT_FOUND", "message": "Agent not found." } }
```

## HTTP Methods

| Method | Usage |
|--------|-------|
| GET    | Retrieve resources |
| POST   | Create resources |
| PATCH  | Update resources |
| DELETE | Soft delete resources |

## Pagination

Cursor pagination preferred. Parameters: `cursor`, `limit`. Optional: `page`, `pageSize`.

---

# 10. Repository Structure

See [[@RULE.REPO_PATTERN.md]] for complete repository rules.

## High-Level Layout

```
woops-platform/
├── src/
│   ├── modules/        # Business features
│   ├── common/         # Framework utilities
│   ├── shared/         # Domain utilities
│   ├── infrastructure/ # External services
│   ├── config/         # Configuration
│   ├── database/       # Prisma
│   └── types/          # Global typings
├── prisma/
├── test/
├── docs/
├── scripts/
└── docker/
```

## Modules

Each business feature is a module:
```
auth/ users/ organizations/ agents/ conversations/
knowledge/ memory/ billing/ runtime/ channels/
integrations/ notifications/ analytics/
```

## Standard Module Structure

```
module/
├── controllers/
├── services/
├── repositories/
├── dto/
├── entities/
├── interfaces/
├── schemas/
├── validators/
├── constants/
├── events/
├── mappers/
├── types/
├── guards/
├── decorators/
└── tests/{unit, integration}/
```

## Dependency Rule

```
Controller → Service → Repository → Prisma
```

Dependencies always point inward. Infrastructure never depends on modules.

---

# 11. Coding Standards

See [[@RULE.CODEBASE.md]] for complete coding rules.

## Engineering Principles

SOLID, DRY, KISS, Clean Architecture, Feature-First Organization, Dependency Injection, Composition over Inheritance.

## File Size Targets

| Component | Max Lines |
|-----------|-----------|
| Service   | 300 |
| Controller| 150 |
| Repository| 250 |

## Forbidden Practices

- Using `any`
- Bypassing repositories
- Business logic in controllers
- Hardcoding secrets
- Duplicating logic
- Circular dependencies
- Coupling modules to infrastructure
- Modifying generated Prisma files

## Naming Conventions

| Element | Convention |
|---------|-----------|
| Classes | PascalCase |
| Interfaces | PascalCase |
| Files/Folders | kebab-case |
| Variables | camelCase |
| Constants | UPPER_SNAKE_CASE |
| Enums | PascalCase |

## Validation

- Validate as early as possible using **Zod**
- Validate: requests, configuration, external payloads
- Never trust external input

## Error Handling

- Throw domain-specific exceptions
- Never expose raw errors or stack traces
- Every error must be predictable, logged, and traceable

## Logging

- Structured JSON only
- Include: Request ID, Correlation ID, User ID, Organization ID, Agent ID
- Never log: passwords, tokens, secrets, personal data

---

# 12. Billing Model

## Plans

| Plan | Description |
|------|-------------|
| Free | Entry-level with limited usage |
| Pro  | Growing businesses |
| Business | Advanced features, higher limits |
| Enterprise | Custom pricing, enterprise support |

## Billing Dimensions

- AI Requests, Workflow Executions, Messages
- Knowledge Storage, Team Members, Active Agents
- Integrations, API Usage

## Billing Ownership

- **Individual:** `User → Subscription`
- **Business:** `Organization → Subscription`

A subscription can never belong to both.

---

# 13. Competitive Advantages

| Advantage | Description |
|-----------|-------------|
| AI-first architecture | Built from the ground up for AI agents |
| Runtime-agnostic | Replaceable workflow engine |
| Modular platform | Clean Architecture, SOLID |
| Multi-tenant by design | Tenant isolation from day one |
| Multi-model AI | Support for OpenAI, Gemini, Anthropic, etc. |
| Enterprise-ready | RBAC, SSO, SCIM (future) |
| Visual Agent Builder | No-code agent creation |

---

# 14. Technical Principles

- **Modular Monolith** — easy to develop, easy to extract into microservices
- **Independent Runtime** — n8n today, replaceable tomorrow
- **Clean Architecture** — domain layer never depends on infrastructure
- **Adapter Pattern** — every external dependency behind an interface
- **Event-Driven** — modules communicate through domain events
- **API-First** — stable, versioned, consistent public contract
- **Cloud-Native** — designed for modern deployment

---

# 15. Future Compatibility

The model must support without redesign:
- Enterprise Organizations
- Teams (inside organizations)
- Custom Roles, RBAC, ABAC
- SSO, SCIM Provisioning
- Plugin Marketplace
- Multiple AI Providers
- Multiple Runtime Engines

---

# 16. Golden Rules

1. **The Platform is the brain.** It owns every business decision, AI decision, security decision, and customer interaction.
2. **The Runtime is an execution engine.** It never makes business decisions, never authenticates users, and never manages permissions.
3. **Every resource has exactly one owner.** Either User or Organization — never both.
4. **No Workspace entity exists.** The tenant hierarchy is Organization → Agent.
5. **The database is the source of truth.** Redis is optimization only.
6. **Repositories are the only database access layer.** No service or controller touches Prisma directly.
7. **Every external dependency is abstracted behind an adapter.** Never call external SDKs directly.
8. **The platform must remain runtime-agnostic.** Switching from n8n to Temporal or a custom engine must not require architectural changes.

---

# 17. Document Map

```
@RULE.BUSINESS_MODEL.md  ← You are here (mother document)
         │
         ├── @RULE.USERS.md           → Identity, ownership, roles & permissions
         ├── @RULE.ARCHITECTURE.md    → System architecture & engineering rules
         ├── @RULE.REPO_PATTERN.md    → Repository structure & folder rules
         ├── @RULE.SCOPE.md           → Current development scope
         ├── @RULE.DB.md              → Database standards & persistence rules
         ├── @RULE.API.md             → REST API design & endpoint rules
         └── @RULE.CODEBASE.md        → Coding standards & implementation guidelines
```

Each document is independent but connected. Changes to the business model propagate to all derived documents.
