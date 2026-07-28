---
tags:
  - woops
  - identity
  - authorization
aliases:
  - User Rules
  - Identity Model
  - Organization Rules
---

# WOOPS Platform — User & Organization Rules
> Identity, Ownership, Roles & Permission Model
>
> Version: 1.0
> Scope: Woops Platform Backend (Control Plane)
>
> This document defines how identities, organizations, permissions, and ownership work inside the Woops Platform.
>
> **These rules apply only to the Woops Platform Backend.**
>
> **Do NOT implement these rules inside the Runtime (n8n).**

---

# Current Scope

This repository is responsible for:

- Authentication
- Authorization
- User Management
- Organization Management
- Permissions
- Ownership
- Billing Ownership

The Runtime (n8n) never authenticates users and never manages permissions.

---

# Identity Types

Woops supports only **three identity roles**.

```
System Administrator

↓

Organization

↓

User
```

No other identity types exist.

---

# 1. System Administrator

A System Administrator belongs to **Woops**, not to a customer.

Examples

- CEO
- Support Team
- Internal Operations
- Finance Team
- Platform Engineers

A System Administrator manages the entire platform.

---

## Responsibilities

A System Administrator can

- View every organization
- View every user
- Suspend organizations
- Suspend users
- Manage subscriptions
- Issue refunds
- View analytics
- Manage feature flags
- Configure global settings
- View system logs
- Access the admin dashboard
- Manage AI providers
- Manage platform integrations

System Administrators never belong to customer organizations.

---

## Restrictions

System Administrators must **never** automatically become members of customer organizations.

If they need access for support purposes, they must use an impersonation mechanism with audit logging.

---

# 2. User (Individual Account)

A User is an individual customer.

The user owns their own resources.

They are **not** part of an organization unless explicitly invited.

---

## User Capabilities

A user can

- Create AI Agents
- Upload Knowledge
- Store Memory
- Connect Integrations
- Manage Billing
- Use APIs
- Create Conversations
- Use Channels

Everything belongs directly to that user.

---

## Ownership

```
User

↓

Agent

↓

Knowledge

↓

Memory

↓

Conversation

↓

Integration
```

The user is the tenant.

---

## Restrictions

Users cannot

- Manage other users
- View another user's resources
- Manage organizations they do not belong to
- Access platform administration

---

# 3. Organization

An Organization represents a company or business.

It owns all business resources.

---

## Organization Capabilities

An organization can

- Invite users
- Remove users
- Assign roles
- Own AI Agents
- Own Knowledge Bases
- Own Integrations
- Own Billing
- Own Conversations
- Own Channels
- Own API Keys

---

## Ownership

```
Organization

↓

Agents

↓

Knowledge

↓

Memory

↓

Integrations

↓

Conversations
```

---

# Organization Members

Users become members only through invitation.

A membership links

```
User

↓

Organization
```

A user may belong to multiple organizations.

An organization may contain many users.

---

# Organization Roles

Supported roles

## Owner

Highest permission.

Can

- Delete organization
- Manage billing
- Invite members
- Remove members
- Assign roles
- Manage API Keys
- Manage agents
- Manage integrations

Every organization must always have at least one Owner.

---

## Admin

Can

- Invite users
- Remove users
- Manage agents
- Manage knowledge
- Manage conversations
- Manage integrations

Cannot

- Delete organization
- Transfer ownership
- Manage subscription ownership

---

## Member

Can

- Use assigned agents
- Create conversations
- Upload knowledge (if permitted)
- Use integrations (if permitted)

Cannot manage organization settings.

---

## Viewer

Read-only access.

Can

- View dashboards
- View conversations
- View reports

Cannot modify data.

---

# User Lifecycle

```
Register

↓

Verify Email

↓

Create Individual Account

↓

(Optional)

Join Organization

↓

Become Organization Member
```

Users never automatically become organizations.

---

# Organization Lifecycle

```
User

↓

Create Organization

↓

Become Owner

↓

Invite Members

↓

Assign Roles
```

---

# Ownership Rules

Every business resource must have exactly one owner.

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

# Resource Ownership

Examples

Individual

```
User

↓

Agent
```

Company

```
Organization

↓

Agent
```

Same rule applies to

- Knowledge
- Memory
- Integrations
- Conversations
- Billing

---

# Billing Ownership

Billing belongs to the owner.

Individual

```
User

↓

Subscription
```

Business

```
Organization

↓

Subscription
```

A subscription can never belong to both.

---

# Authentication

Authentication identifies the identity.

Authentication does **not** grant permissions.

After authentication

↓

Authorization determines access.

---

# Authorization

Every request must determine

1. Who is the user?
2. Is the user a System Administrator?
3. Is the user acting as an Individual?
4. Is the user acting inside an Organization?
5. What role do they have?
6. Do they have permission?

Never trust client-provided roles.

---

# Acting Context

A user always operates in exactly one context.

```
Individual Mode
```

or

```
Organization Mode
```

The active context determines

- Visible agents
- Billing
- Conversations
- Integrations
- Permissions

The frontend should allow switching between contexts.

---

# System Administrator Override

System Administrators can access any customer resource only through an audited impersonation flow.

Every impersonation must record

- Administrator ID
- Target User or Organization
- Timestamp
- Reason
- IP Address

---

# Permission Hierarchy

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

---

# Database Model

Core entities

```
User

Organization

OrganizationMember
```

No Workspace entity exists.

---

# Future Compatibility

The model must support

- Enterprise Organizations
- Teams (inside organizations if introduced later)
- Custom Roles
- RBAC
- ABAC
- SSO
- SCIM Provisioning

without redesigning the ownership model.

---

# Architectural Principles

- Every identity is authenticated.
- Every request is authorized.
- Every resource has exactly one owner.
- Every organization manages its own members.
- Platform administrators are completely isolated from customer data ownership.
- Individual users and organizations follow the same ownership rules.
- The Runtime never manages identities or permissions.

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.DB.md#Ownership Model]] | [[@RULE.API.md#Authorization]] | [[@RULE.ARCHITECTURE.md#Authorization]]

---

# Final Rule

The Woops Platform has three identity levels:

1. **System Administrator** — manages the platform.
2. **Organization** — represents a business and owns shared resources.
3. **User** — represents an individual who either owns personal resources or participates in one or more organizations.

All authentication, authorization, ownership, and permission logic must be implemented exclusively in the Woops Platform Backend.