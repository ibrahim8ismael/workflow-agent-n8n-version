# Woops Agent Engine — Multi-Tenant User Isolation & Authorization Implementation Plan

> Location: `woops-agent-engine/docs/user-isolation-and-security-plan.md`  
> Version: 1.0  
> Target: Woops Platform Backend (`woops-agent-engine`)  
> Objective: Ensure strict data isolation and authorization across all endpoints so that newly created users cannot access, view, or modify any other user's resources under any circumstances.

---

## 1. Executive Summary & Problem Scope

A comprehensive security and access-control audit of `woops-agent-engine` identified three categories of isolation vulnerabilities:

1. **Unprotected Controllers (Missing `JwtAuthGuard` & `TenantAccessGuard`)**:
   - `ConversationsController` (`/conversations`)
   - `MemoryController` (`/memory`)
   - `ChannelsController` (`/channels`)
   - `IntegrationsController` (`/integrations`)
   *Impact*: Any user (or even unauthenticated HTTP requests) can query, read, mutate, or delete conversations, messages, long-term memories, channels, and integration credentials across all users and organizations.

2. **Missing Ownership Checks on Mutation & Detail Endpoints**:
   - `AgentsController` (`PATCH /agents/:id`, `DELETE /agents/:id`, `POST /agents/:id/publish`, `POST /agents/:id/archive`, `POST /agents/:id/skills/:skillId`, `DELETE /agents/:id/skills/:skillId`, `GET /agents/:id/skills`)
   - `SkillsController` (`GET /skills/:id`, `PATCH /skills/:id`, `DELETE /skills/:id`, `POST /skills/:id/publish`, `POST /skills/:id/archive`)
   - `SubscriptionController` (`PATCH /subscriptions/:id/upgrade`, `DELETE /subscriptions/:id`, `POST /subscriptions`)
   *Impact*: An authenticated User B with their own JWT can mutate or delete User A's agents, skills, or subscription simply by passing User A's resource UUID.

3. **Query Parameter User Overrides (Tampering)**:
   - In `ConversationsController.findMany`, `userId` and `organizationId` were accepted directly from query parameters without verifying against `@CurrentUser()`.

---

## 2. Architecture & Authorization Standards

Every protected endpoint in `woops-agent-engine` must enforce the standard three-tier authorization pattern:

```
                  ┌──────────────────────────────────────────────┐
                  │ 1. JwtAuthGuard (Verify Identity)            │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 2. TenantAccessGuard (Verify Active Org)     │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │ 3. Repository/Service Scope (Verify Ownership)│
                  │    WHERE (userId = :userId OR                │
                  │           organizationId = :orgId)           │
                  └──────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Implementation Breakdown

### Phase 1: Attach Guards to Unprotected Controllers

#### 1.1 Conversations Module
- **File**: `src/modules/conversations/controllers/conversations.controller.ts`
- **Actions**:
  - Add `@UseGuards(JwtAuthGuard, TenantAccessGuard)`.
  - Inject `@CurrentUser() user: { id: string; activeContext?: string; organizationId?: string }`.
  - In `create()`: force `userId: user.id` and `organizationId: user.activeContext === 'organization' ? user.organizationId : undefined`.
  - In `findMany()`: restrict search where clause strictly to `user.id` / active `organizationId`. Disallow arbitrary query parameter overrides.
  - In `findById()`, `addMessage()`, `getMessages()`, `update()`, `resolve()`, `archive()`, `remove()`: pass `{ userId, organizationId }` scope into `ConversationsService` and throw `NotFoundException` (`404`) if the thread belongs to another user.

#### 1.2 Memory Module
- **File**: `src/modules/memory/controllers/memory.controller.ts`
- **Actions**:
  - Add `@UseGuards(JwtAuthGuard, TenantAccessGuard)`.
  - Inject `@CurrentUser() user: AuthUser`.
  - In `create()`: auto-bind `userId: user.id` and `organizationId: user.activeContext === 'organization' ? user.organizationId : undefined`.
  - In `findByAgent()` & `searchByAgent()`: verify the agent belongs to the requester's `{ userId, organizationId }` scope before returning memories.
  - In `findById()`, `update()`, `remove()`: scope lookups and mutations strictly by owner scope.

#### 1.3 Channels Module
- **File**: `src/modules/channels/controllers/channels.controller.ts`
- **Actions**:
  - Add `@UseGuards(JwtAuthGuard, TenantAccessGuard)`.
  - Inject `@CurrentUser() user: AuthUser`.
  - In `create()`, `findByAgent()`, `checkAvailability()`: verify that `agentId` belongs to the requesting user/org.
  - In `findById()`, `remove()`: verify channel ownership via agent relationship.

#### 1.4 Integrations Module
- **File**: `src/modules/integrations/controllers/integrations.controller.ts`
- **Actions**:
  - Add `@UseGuards(JwtAuthGuard, TenantAccessGuard)`.
  - Inject `@CurrentUser() user: AuthUser`.
  - In `findByOrganization()`: ensure `organizationId === user.organizationId` and user is an active member.
  - In `create()`: bind `userId = user.id` and validate `organizationId` active membership.
  - In `findById()`, `remove()`, `checkConnection()`: enforce user/org ownership check.

---

### Phase 2: Agents Module Ownership Enforcement

- **Files**:
  - `src/modules/agents/controllers/agents.controller.ts`
  - `src/modules/agents/services/agents.service.ts`
  - `src/modules/agents/repositories/agents.repository.ts`
- **Actions**:
  - In `AgentsController`: inject `@CurrentUser() user: AgentUser` into `update()`, `remove()`, `publish()`, `archive()`, `addSkill()`, `removeSkill()`, and `getSkills()`.
  - Pass `scope: { userId: user.id, organizationId: user.activeContext === 'organization' ? user.organizationId : undefined }` to each service method.
  - In `AgentsService`: update `update()`, `softDelete()`, `publish()`, `archive()`, `addSkill()`, `removeSkill()`, `getSkills()` to accept `scope?: { userId?: string; organizationId?: string }`.
  - Ensure `await this.findById(id, false, scope)` is executed so unauthorized access throws `NotFoundException` (`404`) instead of updating or deleting foreign agents.

---

### Phase 3: Skills Module Scoping

- **Files**:
  - `src/modules/skills/controllers/skills.controller.ts`
  - `src/modules/skills/services/skills.service.ts`
- **Actions**:
  - In `SkillsController`: inject `@CurrentUser() user: SkillUser` into `findById()`, `update()`, `remove()`, `publish()`, and `archive()`.
  - Pass `scope: { userId: user.id, organizationId: user.organizationId }` into the service methods.
  - In `SkillsService`: add scope enforcement so private skills of User A cannot be retrieved or mutated by User B.

---

### Phase 4: Subscription & Billing Scoping

- **File**: `src/modules/billing/controllers/subscription.controller.ts`
- **Actions**:
  - In `create()`: if `organizationId` is passed, verify user is an active member with `OWNER` or `ADMIN` role.
  - In `upgrade()` & `cancel()`: inject `@CurrentUser() user` and verify that the target subscription belongs to `user.id` or `user.organizationId` before updating.

---

### Phase 5: Verification & Multi-Tenant E2E Test Suite

Create automated integration tests in `test/isolation/multi-tenant-isolation.e2e-spec.ts`:
1. **Agent Isolation Test**: User A creates Agent A. User B attempts `GET /agents/:agentA_id`, `PATCH /agents/:agentA_id`, `DELETE /agents/:agentA_id`, and `POST /agents/:agentA_id/publish` ➔ Expected: `404 Not Found`.
2. **Conversation & Message Isolation Test**: User A creates Conversation A. User B attempts `GET /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages` ➔ Expected: `404 Not Found` / empty array.
3. **Memory Isolation Test**: User A creates memory for Agent A. User B attempts `GET /memory/agent/:agentA_id` and `GET /memory/agent/:agentA_id/search` ➔ Expected: `404 Not Found` / empty array.
4. **Channel & Integration Isolation Test**: User A connects Channel A and Integration A. User B attempts access ➔ Expected: `404 Not Found`.
5. **Subscription Isolation Test**: User A creates Subscription A. User B attempts `PATCH /subscriptions/:subA_id/upgrade` and `DELETE /subscriptions/:subA_id` ➔ Expected: `404 Not Found` / `403 Forbidden`.

---

## 4. Acceptance Criteria

- [ ] All 17 backend controllers require valid authentication (`JwtAuthGuard`) unless explicitly public (`auth/otp/*`, `health`).
- [ ] No endpoint allows reading, updating, deleting, or executing resources belonging to other individual users or organizations.
- [ ] Full test suite (`npm run test` and `npm run test:e2e`) passes with 100% green status.
- [ ] No regression in frontend API compatibility.
