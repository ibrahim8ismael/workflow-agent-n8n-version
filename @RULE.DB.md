---
tags:
  - woops
  - database
  - prisma
aliases:
  - Database Rules
  - DB Model
  - Prisma Rules
---

# WOOPS Platform — Database Rules
> Database Standards, Modeling Rules & Persistence Guidelines
>
> Version: 1.0
> Scope: Woops Platform Backend (Control Plane)
>
> This document defines the official database rules for the Woops Platform.
>
> **These rules apply ONLY to the Woops Platform Backend.**
>
> **They do NOT apply to the Workflow Runtime (n8n), Frontend, or any external service.**

---

# Current Scope

The AI Agent is currently working only on the **Woops Platform Backend**.

The Platform database is responsible for storing business data only.

Examples:

- Users
- Organizations
- Organization Members
- Agents
- Knowledge
- Memory
- Conversations
- Billing
- Integrations
- Notifications

The Platform database **must never store workflow execution data**.

Workflow execution belongs to the Runtime service.

---

# Database Technology

Database

```
PostgreSQL 16+
```

ORM

```
Prisma ORM
```

Connection Pool

```
Prisma Accelerate (Future)
```

---

# Source of Truth

The PostgreSQL database is the only source of truth.

Never rely on:

- Redis
- Cache
- Runtime
- AI Memory
- Local Memory

to persist business data.

---

# Repository Rule

Prisma must only be accessed through repositories.

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
Service

↓

Prisma
```

---

# Table Naming

Database tables must use

```
snake_case
```

Examples

```
users

organizations

organization_members

knowledge_documents

runtime_deployments
```

Never use camelCase table names.

---

# Prisma Models

Prisma Models must use

```
PascalCase
```

Examples

```
User

Organization

Conversation

KnowledgeDocument
```

---

# Column Naming

Database columns use

```
camelCase
```

Examples

```
createdAt

updatedAt

organizationId

ownerId
```

---

# Primary Keys

Every table must use

UUID v7

```
id UUID
```

Rules

- No auto-increment IDs.
- No integer IDs.
- No sequential IDs.
- IDs are immutable.
- UUIDs are generated automatically by middleware.

---

# Audit Fields

Every business table must include

```
id

createdAt

updatedAt

deletedAt
```

Definitions

### id

Primary key.

UUID v7.

---

### createdAt

Automatically generated.

Never manually updated.

---

### updatedAt

Automatically updated on every modification.

---

### deletedAt

Used for Soft Delete.

NULL means active.

---

# Soft Delete

Every business table supports Soft Delete.

Never execute

```
DELETE
```

Instead

```
UPDATE

deletedAt = NOW()
```

Repositories automatically ignore deleted records.

Default filter

```
deletedAt IS NULL
```

Hard delete is allowed only for

- Development
- Testing
- Maintenance scripts
- Database cleanup

---

# Ownership Model

Every business resource has exactly one owner.

Owner can be

```
User
```

or

```
Organization
```

Never both.

---

# Ownership Implementation

Business entities should support ownership without duplicating logic.

Example

```
Agent

organizationId?

userId?
```

Exactly one relationship must be populated.

The application layer must validate this rule.

---

# Multi-Tenant Rules

Tenant types

```
Individual User

Organization
```

There are no Workspaces.

There are no nested tenants.

---

# Organization Isolation

Every organization owns its own data.

No organization may access another organization's data.

Tenant isolation is mandatory.

---

# User Isolation

Individual users own only their own resources.

Users cannot access another user's resources.

---

# Organization Membership

Many-to-many relationship.

```
User

↓

OrganizationMember

↓

Organization
```

A user may belong to multiple organizations.

An organization may contain many users.

---

# Foreign Keys

Always use foreign keys.

Never store orphan references.

Example

```
organizationId

↓

Organization.id
```

---

# Relationships

Prefer explicit relationships.

Bad

```
organizationName
```

Good

```
organizationId
```

Never duplicate relational data.

---

# Cascade Rules

Prefer Soft Delete over Cascade Delete.

Allowed

```
Organization

↓

OrganizationMember
```

Avoid cascading deletion for customer-generated content.

Business data should remain recoverable.

---

# Unique Constraints

Every business identifier must have unique constraints.

Examples

```
User.email
```

```
Organization.slug
```

```
ApiKey.key
```

```
Subscription.providerSubscriptionId
```

---

# Composite Constraints

Prefer composite uniqueness when appropriate.

Example

```
Organization

+

Slug
```

instead of global uniqueness.

---

# Indexing Rules

Every foreign key must be indexed.

Examples

```
organizationId

userId

agentId

conversationId
```

---

Additional indexes

```
createdAt

status

email

slug
```

---

# Composite Indexes

Index frequently queried combinations.

Examples

```
organizationId

+

status
```

```
organizationId

+

createdAt
```

---

# JSON Fields

Use JSONB only when the structure is dynamic.

Allowed

```
providerConfig

metadata

runtimeConfig

settings
```

Do not store relational data inside JSON.

---

# Arrays

Avoid PostgreSQL arrays.

Prefer relational tables.

Bad

```
skills[]
```

Better

```
AgentSkill
```

---

# Enums

Use database enums.

Examples

```
UserRole

SubscriptionStatus

AgentStatus

ConversationStatus
```

Never store enum values as arbitrary strings.

---

# Transactions

Use transactions whenever multiple writes must succeed together.

Examples

- Create Organization
- Accept Invitation
- Upgrade Subscription
- Publish Agent

Never leave partial business operations.

---

# Pagination

Every list endpoint must support pagination.

Preferred

Cursor Pagination

Supported

Offset Pagination

Never return unlimited datasets.

---

# Query Rules

Never use

```
SELECT *
```

Always select only required fields.

Avoid N+1 queries.

Optimize joins.

---

# Prisma Rules

Always use

```
Prisma Client
```

Never edit generated Prisma files.

Never bypass repositories.

---

# Migrations

Every schema change requires a migration.

Rules

- Never modify existing migrations.
- Never delete migration history.
- Use descriptive migration names.

Examples

```
create_users

create_agents

add_billing_tables

add_memory_engine
```

---

# Seed Data

Seed data is only for development.

Default seed should include

- Platform Administrator
- Demo User
- Demo Organization
- Demo Organization Owner

Do not seed production data.

---

# Security Rules

Never store plain-text secrets.

Passwords

```
Argon2 Hash
```

Sensitive tokens

```
Encrypted
```

API Keys

```
Hashed
```

---

# Runtime Separation

The Platform database stores only business state.

Examples

Allowed

- Agent metadata
- Deployment requests
- Deployment status
- Execution history summary

Forbidden

- Workflow graph
- Runtime variables
- Execution engine state
- Node execution logs
- Workflow internals

Those belong to the Runtime database.

---

# Future Compatibility

The schema must support future features without breaking existing models.

Examples

- Enterprise Organizations
- SSO
- SCIM
- Custom Roles
- Plugin Marketplace
- Multiple AI Providers
- Multiple Runtime Engines

---

# Database Principles

Always follow these principles:

- PostgreSQL is the source of truth.
- Prisma is the only ORM.
- Repositories are the only database access layer.
- UUID v7 for every primary key.
- Soft Delete by default.
- Every resource has exactly one owner.
- No Workspace entity.
- Tenant isolation is mandatory.
- Normalize first.
- Denormalize only for measured performance.
- Every schema change requires a migration.
- Every business operation must preserve data integrity.

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.USERS.md#Database Model]] | [[@RULE.ARCHITECTURE.md#Database Rule]]

---

# Final Rule

The Woops Platform database represents the **business state** of the platform.

It is responsible for identities, organizations, agents, billing, conversations, memory, and knowledge.

It must remain completely independent from the Workflow Runtime database, ensuring that execution engines can evolve or be replaced without affecting the platform's persistence layer.