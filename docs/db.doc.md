# WOOPS Platform — Database Schema

> Complete Database Schema Definition
>
> Version: 1.0
> Scope: Woops Platform Backend (Control Plane)
>
> This document defines the official database schema for the Woops Platform.
>
> Every model defined here follows the rules in [[@RULE.DB.md]].

---

## 1. Technology Stack

| Component     | Choice          |
| ------------- | --------------- |
| Database      | PostgreSQL 16+  |
| ORM           | Prisma ORM 7    |
| Connection    | Prisma Accelerate (Future) |

---

## 2. Design Principles

### Naming Conventions

| Element           | Convention           | Example                     |
| ----------------- | -------------------- | --------------------------- |
| Tables            | `snake_case`         | `organization_members`      |
| Columns           | `camelCase`          | `createdAt`                 |
| Prisma Models     | `PascalCase`         | `OrganizationMember`        |
| Prisma Enums      | `PascalCase`         | `OrganizationRole`          |

### Required Fields

Every business table must include:

```
id          UUID v7 (primary key)
createdAt   DateTime (auto-generated)
updatedAt   DateTime (auto-updated)
deletedAt   DateTime? (NULL = active)
```

### Primary Keys

- UUID v7 for every table.
- No auto-increment, no integer IDs, no sequential IDs.
- UUID generation is handled by Prisma middleware (not schema).

### Soft Delete

- Every business table uses soft delete.
- `deletedAt IS NULL` is the default filter in all repositories.
- Hard delete is allowed only for development, testing, and maintenance scripts.

### Ownership Model

- Every business resource has exactly **one** owner.
- Owner can be a **User** or an **Organization** — never both.
- Implementation: `userId?` + `organizationId?` on the model.
- Application layer validates exactly one is populated.

### Multi-Tenant Isolation

- Every query must be tenant-aware.
- Cross-tenant access is forbidden.
- No Workspace entity exists.
- No nested tenants.

---

## 3. Enums

```prisma
enum UserRole {
  USER
  SYSTEM_ADMINISTRATOR
}

enum OrganizationRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum AgentStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
  ERROR
}

enum ConversationStatus {
  ACTIVE
  RESOLVED
  ARCHIVED
}

enum MemoryType {
  SHORT_TERM
  LONG_TERM
  BUSINESS
}

enum ChannelType {
  WIDGET
  WHATSAPP
  MESSENGER
  INSTAGRAM
  TELEGRAM
  EMAIL
  SLACK
  DISCORD
  API
}

enum ApiKeyStatus {
  ACTIVE
  REVOKED
  EXPIRED
}

enum SubscriptionTier {
  FREE
  PRO
  BUSINESS
  ENTERPRISE
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
}

enum IntegrationCategory {
  AI
  COMMUNICATION
  CRM
  PAYMENT
  ANALYTICS
  STORAGE
  OTHER
}
```

---

## 4. Entity Definitions

### Layer 1 — Identity

#### User

The central identity for every person using the platform.
System Administrators are identified by `role = SYSTEM_ADMINISTRATOR`.

```prisma
model User {
  id              String     @id @default(uuid())
  email           String     @unique
  name            String?
  avatarUrl       String?
  emailVerifiedAt DateTime?
  role            UserRole   @default(USER)
  isActive        Boolean    @default(true)
  tokenVersion    Int        @default(0)
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  deletedAt       DateTime?

  // Relations
  sessions             Session[]
  apiKeys              ApiKey[]
  organizationMembers  OrganizationMember[]
  sentInvitations      OrganizationMember[]  @relation("SentInvitations")
  agents               Agent[]              @relation("UserAgents")
  conversations        Conversation[]       @relation("UserConversations")
  knowledgeDocuments   KnowledgeDocument[]  @relation("UserKnowledgeDocuments")
  memories             Memory[]             @relation("UserMemories")
  integrations         Integration[]        @relation("UserIntegrations")
  notifications        Notification[]
  subscription         Subscription?        @relation("UserSubscription")
  auditLogs            AuditLog[]

  @@map("users")
}
```

#### Organization

Represents a company or business entity.
Organizations own shared business resources and have members with roles.

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  logoUrl   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  // Relations
  members            OrganizationMember[]
  apiKeys            ApiKey[]
  agents             Agent[]              @relation("OrganizationAgents")
  conversations      Conversation[]       @relation("OrganizationConversations")
  knowledgeDocuments KnowledgeDocument[]  @relation("OrganizationKnowledgeDocuments")
  memories           Memory[]             @relation("OrganizationMemories")
  integrations       Integration[]        @relation("OrganizationIntegrations")
  notifications      Notification[]
  subscription       Subscription?        @relation("OrganizationSubscription")
  invoices           Invoice[]

  @@map("organizations")
}
```

---

### Layer 2 — Identity Relations

#### OrganizationMember

Links a User to an Organization with a specific role.
A user may belong to multiple organizations.

```prisma
model OrganizationMember {
  id             String           @id @default(uuid())
  organizationId String
  userId         String
  role           OrganizationRole @default(MEMBER)
  invitedById    String?
  joinedAt       DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  deletedAt      DateTime?

  // Relations
  organization Organization @relation(fields: [organizationId], references: [id])
  user         User         @relation(fields: [userId], references: [id])
  invitedBy    User?        @relation("SentInvitations", fields: [invitedById], references: [id])

  // Constraints
  @@unique([organizationId, userId])
  @@index([userId])
  @@index([organizationId])
  @@map("organization_members")
}
```

---

### Layer 3 — Authentication

#### Session

Represents a device-based login session.
Each device gets its own session and refresh token family.

```prisma
model Session {
  id         String   @id @default(uuid())
  userId     String
  device     String?
  browser    String?
  ip         String?
  lastUsedAt DateTime @default(now())
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  deletedAt  DateTime?

  // Relations
  user User @relation(fields: [userId], references: [id])

  // Constraints
  @@index([userId])
  @@index([userId, expiresAt])
  @@map("sessions")
}
```

#### ApiKey

Used for machine-to-machine authentication.
Keys are hashed before storage; only the prefix is stored in plain text.

```prisma
model ApiKey {
  id             String       @id @default(uuid())
  name           String
  key            String       @unique
  keyPrefix      String
  status         ApiKeyStatus @default(ACTIVE)
  lastUsedAt     DateTime?
  expiresAt      DateTime?
  userId         String?
  organizationId String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?

  // Relations
  user         User?         @relation(fields: [userId], references: [id])
  organization Organization? @relation(fields: [organizationId], references: [id])

  // Constraints
  @@index([userId])
  @@index([organizationId])
  @@index([status])
  @@map("api_keys")
}
```

---

### Layer 4 — Core Business

#### Agent

The primary product object. An AI Agent configured by a user or organization.
Owned by exactly one User or Organization.

```prisma
model Agent {
  id             String      @id @default(uuid())
  name           String
  description    String?
  instructions   String?
  personality    String?
  model          String
  status         AgentStatus @default(DRAFT)
  userId         String?
  organizationId String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  deletedAt      DateTime?

  // Relations
  user               User?                @relation("UserAgents", fields: [userId], references: [id])
  organization       Organization?        @relation("OrganizationAgents", fields: [organizationId], references: [id])
  skills             AgentSkill[]
  conversations      Conversation[]
  channels           Channel[]
  memories           Memory[]
  runtimeDeployments RuntimeDeployment[]

  // Constraints
  @@index([userId])
  @@index([organizationId])
  @@index([status])
  @@map("agents")
}
```

#### AgentSkill

A skill or tool associated with an AI Agent.
Skills define what the agent can do (e.g., book appointments, send emails).

```prisma
model AgentSkill {
  id        String   @id @default(uuid())
  agentId   String
  skillId   String
  name      String
  enabled   Boolean  @default(true)
  config    Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  // Relations
  agent Agent @relation(fields: [agentId], references: [id])

  // Constraints
  @@unique([agentId, skillId])
  @@index([agentId])
  @@map("agent_skills")
}
```

#### Conversation

A conversation between a user and an AI Agent.
May be owned by a User (individual) or Organization (shared).

```prisma
model Conversation {
  id             String             @id @default(uuid())
  title          String?
  status         ConversationStatus @default(ACTIVE)
  metadata       Json?
  agentId        String
  userId         String?
  organizationId String?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
  deletedAt      DateTime?

  // Relations
  agent        Agent     @relation(fields: [agentId], references: [id])
  user         User?     @relation("UserConversations", fields: [userId], references: [id])
  organization Organization? @relation("OrganizationConversations", fields: [organizationId], references: [id])
  messages     Message[]

  // Constraints
  @@index([agentId])
  @@index([userId])
  @@index([organizationId])
  @@index([status])
  @@index([agentId, status])
  @@map("conversations")
}
```

#### Message

An individual message within a conversation.
Messages are immutable after creation.

```prisma
model Message {
  id             String   @id @default(uuid())
  conversationId String
  role           String
  content        String
  metadata       Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  // Relations
  conversation Conversation @relation(fields: [conversationId], references: [id])

  // Constraints
  @@index([conversationId])
  @@index([conversationId, createdAt])
  @@map("messages")
}
```

---

### Layer 5 — Knowledge & Memory

#### KnowledgeDocument

A knowledge source uploaded or connected to the platform.
Documents are processed and split into chunks for vector search.

```prisma
model KnowledgeDocument {
  id             String   @id @default(uuid())
  title          String
  source         String?
  contentType    String
  content        String?
  metadata       Json?
  userId         String?
  organizationId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  // Relations
  user         User?                    @relation("UserKnowledgeDocuments", fields: [userId], references: [id])
  organization Organization?            @relation("OrganizationKnowledgeDocuments", fields: [organizationId], references: [id])
  chunks       KnowledgeDocumentChunk[]

  // Constraints
  @@index([userId])
  @@index([organizationId])
  @@map("knowledge_documents")
}
```

#### KnowledgeDocumentChunk

A vector-indexed chunk of a knowledge document.
Each chunk contains a text fragment and its embedding vector.

```prisma
model KnowledgeDocumentChunk {
  id                 String   @id @default(uuid())
  knowledgeDocumentId String
  content            String
  embedding          Unsupported("vector(1536)")?
  metadata           Json?
  chunkIndex         Int
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?

  // Relations
  knowledgeDocument KnowledgeDocument @relation(fields: [knowledgeDocumentId], references: [id])

  // Constraints
  @@index([knowledgeDocumentId])
  @@index([knowledgeDocumentId, chunkIndex])
  @@map("knowledge_document_chunks")
}
```

#### Memory

Agent memory entries for short-term, long-term, and business context.
Owned by a User or Organization.

```prisma
model Memory {
  id             String     @id @default(uuid())
  agentId        String
  type           MemoryType
  key            String
  content        String
  metadata       Json?
  userId         String?
  organizationId String?
  expiresAt      DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  deletedAt      DateTime?

  // Relations
  agent        Agent         @relation(fields: [agentId], references: [id])
  user         User?         @relation("UserMemories", fields: [userId], references: [id])
  organization Organization? @relation("OrganizationMemories", fields: [organizationId], references: [id])

  // Constraints
  @@unique([agentId, key, type])
  @@index([agentId])
  @@index([userId])
  @@index([organizationId])
  @@index([type])
  @@map("memories")
}
```

---

### Layer 6 — Integrations & Channels

#### Integration

A third-party service connection (e.g., Stripe, Slack, Gmail).

```prisma
model Integration {
  id             String              @id @default(uuid())
  name           String
  category       IntegrationCategory
  provider       String
  status         String              @default("DISCONNECTED")
  config         Json?
  userId         String?
  organizationId String?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
  deletedAt      DateTime?

  // Relations
  user         User?                  @relation("UserIntegrations", fields: [userId], references: [id])
  organization Organization?          @relation("OrganizationIntegrations", fields: [organizationId], references: [id])
  credentials  IntegrationCredential[]

  // Constraints
  @@index([userId])
  @@index([organizationId])
  @@index([provider])
  @@index([category])
  @@map("integrations")
}
```

#### IntegrationCredential

Encrypted credentials for an integration.
Credentials are encrypted at rest and never returned in plain text.

```prisma
model IntegrationCredential {
  id            String   @id @default(uuid())
  integrationId String
  encryptedData String
  expiresAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  // Relations
  integration Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  // Constraints
  @@index([integrationId])
  @@map("integration_credentials")
}
```

#### Channel

A communication channel attached to an AI Agent.
Agents can communicate through multiple channels simultaneously.

```prisma
model Channel {
  id        String      @id @default(uuid())
  agentId   String
  type      ChannelType
  name      String?
  status    String      @default("ACTIVE")
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  deletedAt DateTime?

  // Relations
  agent   Agent           @relation(fields: [agentId], references: [id])
  configs ChannelConfig[]

  // Constraints
  @@unique([agentId, type])
  @@index([agentId])
  @@map("channels")
}
```

#### ChannelConfig

Configuration key-value pairs for a channel.
Values containing secrets are encrypted.

```prisma
model ChannelConfig {
  id        String   @id @default(uuid())
  channelId String
  key       String
  value     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  // Relations
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  // Constraints
  @@unique([channelId, key])
  @@index([channelId])
  @@map("channel_configs")
}
```

---

### Layer 7 — Runtime

#### RuntimeDeployment

Tracks the deployment state of an agent to the Workflow Runtime.
This is the bridge between the Platform and the execution engine.

```prisma
model RuntimeDeployment {
  id                 String   @id @default(uuid())
  agentId            String
  version            Int
  status             String   @default("PENDING")
  runtimeUrl         String?
  runtimeDeploymentId String?
  metadata           Json?
  deployedAt         DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  deletedAt          DateTime?

  // Relations
  agent Agent @relation(fields: [agentId], references: [id])

  // Constraints
  @@unique([agentId, version])
  @@index([agentId])
  @@index([status])
  @@map("runtime_deployments")
}
```

---

### Layer 8 — Billing

#### SubscriptionPlan

Defines available subscription tiers and their pricing.

```prisma
model SubscriptionPlan {
  id          String           @id @default(uuid())
  tier        SubscriptionTier @unique
  name        String
  description String?
  price       Decimal
  currency    String           @default("USD")
  interval    String
  features    Json?
  isActive    Boolean          @default(true)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  deletedAt   DateTime?

  // Relations
  subscriptions Subscription[]

  @@map("subscription_plans")
}
```

#### Subscription

An active subscription owned by a User or Organization.
Each subscription references a provider-side subscription ID.

```prisma
model Subscription {
  id                    String             @id @default(uuid())
  planId                String
  status                SubscriptionStatus @default(ACTIVE)
  currentPeriodStart    DateTime
  currentPeriodEnd      DateTime
  provider              String
  providerSubscriptionId String            @unique
  trialEndsAt           DateTime?
  canceledAt            DateTime?
  userId                String?
  organizationId        String?
  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  deletedAt             DateTime?

  // Relations
  plan         SubscriptionPlan @relation(fields: [planId], references: [id])
  user         User?            @relation("UserSubscription", fields: [userId], references: [id])
  organization Organization?    @relation("OrganizationSubscription", fields: [organizationId], references: [id])
  invoices     Invoice[]

  // Constraints
  @@index([planId])
  @@index([userId])
  @@index([organizationId])
  @@index([status])
  @@index([provider, providerSubscriptionId])
  @@map("subscriptions")
}
```

#### Invoice

A billing invoice generated for a subscription.

```prisma
model Invoice {
  id              String   @id @default(uuid())
  subscriptionId  String
  amount          Decimal
  currency        String   @default("USD")
  status          String   @default("PENDING")
  providerInvoiceId String?
  paidAt          DateTime?
  dueDate         DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  // Relations
  subscription Subscription @relation(fields: [subscriptionId], references: [id])

  // Constraints
  @@index([subscriptionId])
  @@index([status])
  @@index([subscriptionId, status])
  @@map("invoices")
}
```

---

### Layer 9 — System

#### Notification

A notification sent to a user or organization.
Could be triggered by system events, billing updates, or agent activity.

```prisma
model Notification {
  id             String   @id @default(uuid())
  type           String
  title          String
  message        String?
  data           Json?
  readAt         DateTime?
  userId         String?
  organizationId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  // Relations
  user         User?         @relation(fields: [userId], references: [id])
  organization Organization? @relation(fields: [organizationId], references: [id])

  // Constraints
  @@index([userId])
  @@index([organizationId])
  @@index([readAt])
  @@index([createdAt])
  @@map("notifications")
}
```

#### AuditLog

Immutable audit trail for security-sensitive operations.
Used for compliance, debugging, and System Administrator impersonation tracking.

```prisma
model AuditLog {
  id         String   @id @default(uuid())
  action     String
  entityType String
  entityId   String?
  userId     String?
  metadata   Json?
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  deletedAt  DateTime?

  // Relations
  user User? @relation(fields: [userId], references: [id])

  // Constraints
  @@index([action])
  @@index([entityType, entityId])
  @@index([userId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

---

## 5. Complete Prisma Schema

The full `prisma/schema.prisma` file is assembled from:

1. **Generator & Datasource** (already in place)
2. **Enum definitions** (Section 3 above)
3. **Model definitions** (Section 4 above)

Copy the enums and models into `prisma/schema.prisma` in this order:

```prisma
// 1. Generator
generator client {
  provider = "prisma-client-js"
}

// 2. Datasource
datasource db {
  provider = "postgresql"
}

// 3. Enums (copy from Section 3)

// 4. Models (copy from Section 4 in order)
```

---

## 6. Cross-Cutting Patterns

### Soft Delete Implementation

All repositories implement a base filter:

```typescript
// All queries automatically include:
where: { deletedAt: null }

// Update for soft delete:
update({ where: { id }, data: { deletedAt: new Date() } })
```

Hard delete is never used in application code. Repositories expose soft delete only.

### Ownership Query Pattern

Business entities with ownership use this pattern in repositories:

```typescript
// When userId is set:
where: { userId, deletedAt: null }

// When organizationId is set:
where: { organizationId, deletedAt: null }

// Ownership validation:
const validOwner = entity.userId || entity.organizationId;
// Exactly one must be non-null
```

### Transaction Boundaries

Use Prisma transactions for multi-write operations:

- Creating an Organization (create org + create owner membership)
- Accepting an invitation (create membership + update status)
- Upgrading a subscription (update current + create invoice)
- Publishing an Agent (update status + create deployment)

### Migration Naming

Migration names should be descriptive and follow this pattern:

```
create_users
create_organizations
create_organization_members
create_agents
add_billing_tables
add_memory_engine
add_runtime_deployments
```

### Seed Data

Development seed data should include:

1. **Platform Administrator** — a `User` with `role = SYSTEM_ADMINISTRATOR`
2. **Demo User** — a regular `User` for testing
3. **Demo Organization** — an `Organization` for testing
4. **Demo Organization Owner** — `OrganizationMember` with `role = OWNER`
5. **Demo Agent** — an `Agent` owned by the demo organization
6. **Seed Subscription Plans** — FREE, PRO, BUSINESS, ENTERPRISE

### Indexing Strategy

Every foreign key must be indexed:

| Column           | Index On               |
| ---------------- | ---------------------- |
| `userId`         | All entities with FK   |
| `organizationId` | All entities with FK   |
| `agentId`        | Skills, Conversations, Channels, Memories, Deployments |
| `conversationId` | Messages               |
| `subscriptionId` | Invoices               |
| `integrationId`  | Credentials            |

Additional indexes on frequently queried columns:

| Column         | Entities                          |
| -------------- | --------------------------------- |
| `email`        | User                              |
| `slug`         | Organization                      |
| `status`       | Agent, Conversation, Subscription |
| `createdAt`    | All list endpoints                |
| `type`         | Memory, Channel                   |
| `action`       | AuditLog                          |
| `readAt`       | Notification                      |

Composite indexes on frequent query combinations:

| Combination              | Entity       |
| ------------------------ | ------------ |
| `organizationId` + `status` | Agent, Conversation |
| `userId` + `status`         | Agent, Conversation |
| `agentId` + `type`          | Memory       |
| `subscriptionId` + `status` | Invoice      |

### JSONB Fields

JSONB is used only for dynamic or flexible structures:

| Entity               | JSONB Fields       |
| -------------------- | ------------------ |
| Agent                | —                  |
| AgentSkill           | `config`           |
| Conversation         | `metadata`         |
| Message              | `metadata`         |
| KnowledgeDocument    | `metadata`         |
| KnowledgeDocumentChunk | `metadata`       |
| Memory               | `metadata`         |
| Integration          | `config`           |
| RuntimeDeployment    | `metadata`         |
| SubscriptionPlan     | `features`         |
| Notification         | `data`             |
| AuditLog             | `metadata`         |

Do not store relational data inside JSONB fields.

---

## 7. Relationship Map

```
User ──< Session
User ──< ApiKey >── Organization
User ──< OrganizationMember >── Organization
User ──< Notification >── Organization
User ──< Subscription >── Organization
User ──< AuditLog
User ──< Agent >── Organization
Agent ──< AgentSkill
Agent ──< Conversation >── User/Organization
Conversation ──< Message
Agent ──< Channel
Channel ──< ChannelConfig
Agent ──< Memory >── User/Organization
User/Organization ──< KnowledgeDocument
KnowledgeDocument ──< KnowledgeDocumentChunk
User/Organization ──< Integration
Integration ──< IntegrationCredential
Agent ──< RuntimeDeployment
Subscription ──< Invoice
SubscriptionPlan ──< Subscription
```

---

## 8. Key Constraints Summary

| Constraint Type | Definition                                |
| --------------- | ----------------------------------------- |
| Unique Email    | `User.email`                              |
| Unique Slug     | `Organization.slug`                       |
| Unique API Key  | `ApiKey.key`                              |
| Unique Provider Sub | `Subscription.providerSubscriptionId` |
| Org Membership  | `OrganizationMember: unique([orgId, userId])` |
| Agent Skill     | `AgentSkill: unique([agentId, skillId])`  |
| Agent Channel   | `Channel: unique([agentId, type])`        |
| Memory Key      | `Memory: unique([agentId, key, type])`    |
| Deployment Ver  | `RuntimeDeployment: unique([agentId, version])` |
| Channel Config  | `ChannelConfig: unique([channelId, key])` |
| Plan Tier       | `SubscriptionPlan.tier`                   |

---

## 9. Relationship to @RULE Files

- **[[@RULE.DB.md]]** — This schema implements all rules from the database standards document.
- **[[@RULE.USERS.md]]** — User, Organization, and OrganizationMember models implement the identity model.
- **[[@RULE.BUSINESS_MODEL.md]]** — All entities reflect the business model's ownership and entity structure.
- **[[@RULE.SCOPE.md]]** — Only Platform entities are defined; no Runtime execution data is stored.

---

> This schema is the authoritative definition of the Woops Platform database.
> Every model, field, constraint, and index is documented here.
> Changes to the database must be reflected in this document and in `prisma/schema.prisma`.
