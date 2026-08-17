# Woops Agent Engine $\leftrightarrow$ Workflow Engine (n8n) Wiring Plan

> **Document Version:** 2.0.0  
> **Status:** Approved Architecture & Phased Implementation Plan  
> **Owner:** Woops Core Platform Engineering  
> **Target Repositories:** `woops-agent-engine` (NestJS) $\leftrightarrow$ `woops-workflow-engine` (n8n Monorepo)  
> **References:** `docs/woops-agent-to-n8n-notes.md`, `@RULE.AGENT.N8N.CALL.md`, `@RULE.AGENT.CHANNELS.md`, `@RULE.AGENT.SKILL.md`, `@RULE.ARCHITECTURE.md`

---

## 1. Executive Summary & Product Vision

### Woops is an AI Employee Platform (AI Employee OS)
Woops is **not** a generic chatbot builder or a raw agent runtime wrapper. Woops is an **AI Employee Platform for businesses**.

The platform owns the entire business layer around an intelligent AI employee:
* Employee identity, role, and persona
* Skills (business capabilities)
* Memory (cross-run persistent intelligence)
* Knowledge (enterprise context via vector search)
* Policies, permissions, and guardrails
* Multi-tenant data boundaries & user isolation
* Conversations & Runs
* Human escalation & approval lifecycles

```
                         WOOPS: AI EMPLOYEE OS
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
      Business / Brain Layer                    Execution Layer
                │                                     │
       Employee / Skills                        Skill Executor
       Knowledge / Memory                             │
       Policies / Permissions                   ┌─────┼─────────┐
       Conversations / Runs                     │     │         │
       Planning Engine                         n8n  Native   Future
                │                                     │     Runtimes
                └──────────────────┬──────────────────┘
                                   │
                            External Systems
                  (CRM, ERP, WhatsApp, Slack, Stripe)
```

### Strategic Axioms & Architectural Principles
1. **Woops Owns the Business Layer; Runtimes Provide Execution:** The agent/workflow execution engine is an infrastructure adapter that remains replaceable.
2. **The Agent Must Never Know About n8n:** The LLM and planner reason strictly in terms of business capabilities (`search_customer`, `create_invoice`), never implementation details (`hubspot-search-v1`, `executionEngine: n8n`).
3. **Skills Are Business Capabilities (Not 1:1 n8n Workflows):** A Skill abstracts execution. Backends can be `N8N` (external automation), `NATIVE` (local computation), `HTTP` (direct API), or `ASYNC` (human-in-the-loop).
4. **Zero Credential Leakage:** Third-party credentials (OAuth tokens, API keys, refresh tokens) live exclusively inside `woops-workflow-engine` (n8n). They are never exposed to LLMs, prompts, logs, memory, or traces.
5. **Source of Truth Boundary:** Woops is the single source of truth for business state (Organizations, Agents, Skills, Runs, Conversations, Memories). n8n is an execution and integration engine, not a business database.
6. **Vertical Slice MVP Strategy:** Prove value with **one AI Employee (Jaafar)** performing **one real capability (`search_customer`)** end-to-end before building sprawling platform infrastructure.

---

## 2. System Architecture & Interaction Boundaries

```
                               ┌─────────────────────────────────────────────────────────┐
                               │                    External World                       │
                               │  (WhatsApp, Slack, Telegram, Shopify, Stripe, HubSpot)   │
                               └───────────▲─────────────────────────────────┬───────────┘
                                           │                                 │
                                    Outbound APIs                     Inbound Webhooks
                                           │                                 │
                   ┌───────────────────────┴─────────────────────────────────▼───────────────────────┐
                   │                                                                                 │
                   │               WOOPS WORKFLOW ENGINE (n8n Monorepo)                              │
                   │                                                                                 │
                   │  ┌─────────────────────────┐  ┌───────────────────────┐  ┌───────────────────┐  │
                   │  │ Channel Ingestion Hooks │  │ Skill Execution Nodes │  │ OAuth / Cred Vault│  │
                   │  └────────────┬────────────┘  └───────────▲───────────┘  └─────────▲─────────┘  │
                   └───────────────┼───────────────────────────┼────────────────────────┼────────────┘
                                   │                           │                        │
       [Inbound Trigger]           │                           │ [Outbound Execution]   │ [Readiness Check]
       POST /channels/inbound      │                           │ POST /webhook/skill-*  │ GET /integrations/status
       HMAC Signed                 │                           │ Idempotency-Key        │ Inter-service Auth
                                   │                           │                        │
                   ┌───────────────▼───────────────────────────┴────────────────────────┴────────────┐
                   │                                                                                 │
                   │                 WOOPS AGENT ENGINE (NestJS Platform)                            │
                   │                                                                                 │
                   │  ┌────────────────────────┐  ┌───────────────────────┐  ┌───────────────────┐  │
                   │  │ Channel Gateway / Auth │  │ Jaafar Planner & Run  │  │ Skill & Tool Reg  │  │
                   │  └────────────┬───────────┘  └───────────▲───────────┘  └─────────▲─────────┘  │
                   │               │                          │                        │             │
                   │               ▼                          ▼                        │             │
                   │  ┌────────────────────────────────────────────────────────────────┴──────────┐  │
                   │  │ Context Engine: Memory (Postgres) + Knowledge (pgvector) + Vercel AI SDK  │  │
                   │  └───────────────────────────────────────────────────────────────────────────┘  │
                   └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 4 Inter-Service Wiring Vectors

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                4 INTER-SERVICE WIRING VECTORS                                      │
├────────────────────────────────┬────────────────────────────────┬──────────────────────────────────┤
│ 1. Outbound Skill Execution    │ Agent Engine → n8n             │ Synchronous/Async skill runs     │
│ 2. Inbound Multi-Channel Hub   │ n8n → Agent Engine             │ WhatsApp/Slack/Email ingestion   │
│ 3. Human-in-the-Loop Callback  │ n8n → Agent Engine             │ Async resume on approval/webhook │
│ 4. Catalog & Readiness Sync    │ Bi-directional Sync            │ Status check & dynamic discovery │
└────────────────────────────────┴────────────────────────────────┴──────────────────────────────────┘
```

---

### Vector 1: Outbound Skill Execution (Agent Engine $\to$ n8n)

#### Flow
1. User asks Jaafar: *"Find the customer with email sarah@acme.com"*.
2. Planner identifies the intent and selects the business skill: `search_customer`.
3. `SkillEmployeeRuntimeService` / `ToolExecutorService` looks up the skill in `SkillRegistry`.
4. The registry maps `search_customer` to the `N8N` execution adapter (slug: `hubspot-search-v1`).
5. `N8nIntegrationRegistryService` confirms the integration is connected.
6. `N8nWorkflowExecutorService` dispatches an HTTP POST request to n8n webhook with the structured execution envelope, HMAC signature, and idempotency key.
7. n8n executes the workflow against HubSpot using stored credentials.
8. Structured JSON is returned to Agent Engine and injected into the Run Context.
9. Jaafar produces a natural-language response for the user.

#### Outbound Request Envelope (`POST ${N8N_WEBHOOK_BASE}/${workflowSlug}`)

```json
{
  "executionId": "exec_01J8F9...",
  "runId": "run_01J8F9...",
  "planStepId": "step_2",
  "skillSlug": "search_customer",
  "organizationId": "org_12345",
  "userId": "user_67890",
  "agentId": "agent_jaafar",
  "conversationId": "conv_98765",
  "input": {
    "email": "sarah@acme.com"
  },
  "metadata": {
    "environment": "production",
    "timestamp": 1786971460
  }
}
```

#### Inter-Service Headers
* `Content-Type: application/json`
* `Idempotency-Key: ${runId}:${planStepId}:${skillVersion}`
* `X-Woops-Internal-Key: ${WOOPS_INTERNAL_SECRET}`
* `X-Woops-Signature: sha256=${HMAC_HEX}`
* `X-Woops-Timestamp: ${UNIX_EPOCH_SECONDS}`

#### Outbound Response from n8n

```json
{
  "success": true,
  "data": {
    "customerId": "hs_99812",
    "name": "Sarah Connor",
    "email": "sarah@acme.com",
    "company": "Acme Corp",
    "status": "ACTIVE_SUBSCRIBER",
    "tier": "ENTERPRISE"
  },
  "metadata": {
    "executionTimeMs": 380,
    "nodesExecuted": 3
  }
}
```

---

### Vector 2: Inbound Multi-Channel Ingestion (n8n $\to$ Agent Engine)

#### Flow
1. External user sends a WhatsApp message.
2. n8n WhatsApp Webhook Trigger receives the Meta Cloud API payload.
3. n8n normalizes the raw webhook into a standard **`WoopsChannelMessage`**.
4. n8n calls Agent Engine: `POST /api/v1/channels/inbound`.
5. Channel Gateway resolves/creates the `Conversation`, loads the AI Employee (`agentId`), and starts a `Run`.
6. Jaafar plans, executes necessary skills, and generates the response.
7. Agent Engine returns the final response payload (or streams chunks).
8. n8n receives the output and dispatches the formatted message back to WhatsApp.

#### Inbound Ingestion Contract (`POST /api/v1/channels/inbound`)

```json
{
  "channelType": "WHATSAPP",
  "channelIdentifier": "+14155552671",
  "externalUserId": "wa_user_991823",
  "externalMessageId": "wamid.HBgLM...",
  "externalConversationId": "+14155552671",
  "sender": {
    "name": "Sarah Connor",
    "phone": "+14155552671",
    "email": "sarah@resistance.org"
  },
  "message": {
    "type": "text",
    "content": "Can you check my subscription status?",
    "attachments": []
  },
  "metadata": {
    "source": "meta-cloud-api",
    "organizationId": "org_12345"
  }
}
```

---

### Vector 3: Async Execution & Human-in-the-Loop Callbacks

#### Flow
1. Jaafar executes a sensitive skill requiring human authorization (e.g. `refund_customer`).
2. Skill Executor dispatches request to n8n.
3. n8n posts an interactive Slack approval card to the operations channel and returns `{ "status": "WAITING_FOR_APPROVAL", "approvalToken": "appr_9981" }`.
4. Agent Engine sets Run state to `WAITING`.
5. Manager clicks **"Approve"** in Slack.
6. n8n receives the interaction, verifies identity, and calls `POST /api/v1/runs/:id/callbacks`.
7. Agent Engine validates the signature, transitions Run to `RUNNING`, completes the step, and notifies the user.

#### Callback Contract (`POST /api/v1/runs/:id/callbacks`)

```json
{
  "callbackId": "cb_01J9...",
  "runId": "run_01J8F9...",
  "planStepId": "step_3",
  "status": "COMPLETED",
  "action": "APPROVED",
  "approver": {
    "userId": "user_manager_1",
    "email": "finance-lead@acme.com",
    "timestamp": 1786972000
  },
  "output": {
    "approved": true,
    "decisionNote": "Approved refund under $100 limit",
    "refundTransactionId": "rf_881923"
  }
}
```

---

### Vector 4: Catalog & Integration Readiness Sync

#### Flow
1. Planner assesses whether an integration is needed before proposing a plan.
2. Agent Engine checks local cached status (`integrations` table).
3. If stale, Agent Engine queries n8n:
   `GET /api/v1/integrations/status?organizationId=org_12345&provider=hubspot`
4. n8n checks token health in credential vault and responds:
   `{ "connected": true, "scopes": ["crm.objects.contacts.read"] }`
5. Agent can proceed without risking authentication failure during execution.

---

## 4. Security, Trust & Idempotency Model

### Inter-Service HMAC Authentication
All inter-service traffic between `woops-agent-engine` and `woops-workflow-engine` is signed using HMAC-SHA256:

$$\text{Signature} = \text{HMAC-SHA256}(\text{Secret}, \text{Timestamp} + "." + \text{HTTP\_METHOD} + "." + \text{PATH} + "." + \text{RawBody})$$

#### Security Invariants
* **Replay Protection Window:** 300 seconds. Timestamp drift $> 300\text{s}$ rejected with HTTP 401.
* **Shared Secret Storage:** `WOOPS_INTER_SERVICE_SECRET` stored in environment/secrets manager only.

### Stable Execution Idempotency
To prevent duplicate execution of side-effect skills (payments, emails, CRM updates):
* **Key Format:** `${runId}:${planStepId}:${skillVersion}`
* **Persisted States:** `PROCESSING`, `SUCCEEDED`, `FAILED`, `EXPIRED`.
* If a network retry occurs while an operation is `PROCESSING`, the executor waits or retrieves the cached `SUCCEEDED` result instead of re-triggering n8n.

---

## 5. Phased Implementation Roadmap (Vertical Slice Strategy)

```mermaid
gantt
    title Woops Agent-Engine ↔ n8n Implementation Roadmap
    dateFormat  YYYY-MM-DD
    section Milestone 1 (MVP Vertical Slice)
    HMAC Inter-Service Guard & Client       :m1_1, 2026-08-18, 2d
    Skill Execution Abstraction Layer      :m1_2, after m1_1, 2d
    Jaafar search_customer n8n Vertical Slice:m1_3, after m1_2, 3d
    section Milestone 2 (Inbound Channel)
    Channels Inbound Controller             :m2_1, after m1_3, 3d
    WhatsApp n8n Normalization Template     :m2_2, after m2_1, 2d
    section Milestone 3 (Async & HITL)
    Run Checkpoints & WAITING State         :m3_1, after m2_2, 3d
    Slack Human Approval & Resume Callback  :m3_2, after m3_1, 3d
    section Milestone 4 (Platformization)
    Dynamic Catalog & Schema Sync           :m4_1, after m3_2, 4d
    Resilience, Circuit Breakers & Metrics  :m4_2, after m4_1, 3d
```

---

### Milestone 1: MVP Vertical Slice — Outbound Skill Execution (Jaafar + `search_customer`)

> **Goal:** Prove the full end-to-end loop for one real AI Employee and one real capability without building excessive infrastructure.

#### Tasks
- [ ] **1.1 Inter-Service Authentication & Transport:**
  - Create `src/infrastructure/auth/inter-service-auth.guard.ts` in `woops-agent-engine` with HMAC validation.
  - Implement request signing in `N8nWorkflowExecutorService`.
- [ ] **1.2 Skill Abstraction & Adapter Layer:**
  - Refactor `SkillEmployeeRuntimeService` to decouple skill definitions from execution engine.
  - Ensure the Planner only sees business attributes (name, description, schemas) and is completely oblivious to n8n.
- [ ] **1.3 Implement `search_customer` End-to-End Slice:**
  - Create n8n workflow for `search_customer` connecting to HubSpot / Mock CRM.
  - Test the full loop: `User Request → Jaafar → Planner → search_customer Skill → n8n → CRM → Jaafar Response`.
  - Validate zero credential leakage in logs, traces, and LLM context.

---

### Milestone 2: MVP Inbound Channel — Single Channel (WhatsApp)

> **Goal:** Ingest real incoming messages from WhatsApp through n8n, run the AI Employee, and reply back to WhatsApp.

#### Tasks
- [ ] **2.1 Inbound Channel Gateway Controller:**
  - Create `src/modules/channels/controllers/channels-inbound.controller.ts` (`POST /api/v1/channels/inbound`).
  - Implement `ChannelsInboundService` to map external WhatsApp ID to Conversation and dispatch Run.
- [ ] **2.2 n8n WhatsApp Channel Workflow:**
  - Configure Meta WhatsApp Cloud API webhook receiver in n8n.
  - Transform Meta payload into `WoopsChannelMessage`.
  - POST to `woops-agent-engine` and send response back via WhatsApp Send Message node.

---

### Milestone 3: MVP Async & Human-in-the-Loop (Manager Approval)

> **Goal:** Support long-running workflows with human escalation (e.g. refund authorization).

#### Tasks
- [ ] **3.1 Run Checkpoints & WAITING State:**
  - Support `WAITING_FOR_APPROVAL` state in `JaafarRuntimeService`.
  - Create `POST /api/v1/runs/:id/callbacks` endpoint.
- [ ] **3.2 Slack Approval Workflow:**
  - n8n workflow posts interactive Slack card with Approve/Reject buttons.
  - Upon manager action, n8n invokes callback endpoint to resume the Run.

---

### Milestone 4: Production Platformization & Hardening

> **Goal:** Scale to multiple channels, automate skill synchronization, and ensure production-grade reliability.

#### Tasks
- [ ] **4.1 Dynamic Catalog & Readiness Discovery:**
  - Build `N8nApiClientService` to query active workflows and OAuth token status.
- [ ] **4.2 Multi-Channel Templates:**
  - Add templates for Telegram, Slack, and Email ingestion.
- [ ] **4.3 Resilience & Circuit Breakers:**
  - Implement circuit breakers, exponential backoff, and Prometheus metrics for n8n execution telemetry.

---

## 6. Environment Configuration Matrix

### `woops-agent-engine` `.env`

```bash
# ──────────────────────────────────────────────
# Workflow Engine (n8n) Integration
# ──────────────────────────────────────────────
N8N_BASE_URL=http://workflow-engine:5678
N8N_WEBHOOK_URL=http://workflow-engine:5678/webhook
N8N_API_URL=http://workflow-engine:5678/api/v1
N8N_API_KEY=woops_n8n_api_key_secret_0123456789
N8N_TIMEOUT_MS=30000
N8N_MAX_RETRIES=3

# Inter-Service Security
WOOPS_INTER_SERVICE_SECRET=woops_hmac_shared_secret_abcdef0123456789
WOOPS_SIGNATURE_EXPIRY_SECONDS=300

# Dynamic Skill Workflow Mapping (Fallback)
N8N_WORKFLOW_MAP={"search_customer":{"workflow":"hubspot-search-v1","requiredIntegration":"hubspot"}}
```

### `woops-workflow-engine` `.env`

```bash
# ──────────────────────────────────────────────
# Woops Agent Engine Connection
# ──────────────────────────────────────────────
WOOPS_AGENT_ENGINE_URL=http://agent-engine:3000/api/v1
WOOPS_INTER_SERVICE_SECRET=woops_hmac_shared_secret_abcdef0123456789
WOOPS_INTERNAL_API_KEY=woops_n8n_api_key_secret_0123456789

# n8n Core Settings
N8N_PORT=5678
N8N_HOST=0.0.0.0
WEBHOOK_URL=http://localhost:5678/
N8N_ENCRYPTION_KEY=woops_n8n_encryption_key_123456
```

---

## 7. Unified Docker Compose Setup

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: woops
      POSTGRES_PASSWORD: woops
      POSTGRES_DB: woops
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - woops-network

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    networks:
      - woops-network

  agent-engine:
    build:
      context: ./woops-agent-engine
    environment:
      DATABASE_URL: postgresql://woops:woops@postgres:5432/woops
      REDIS_URL: redis://redis:6379
      N8N_WEBHOOK_URL: http://workflow-engine:5678/webhook
      N8N_API_URL: http://workflow-engine:5678/api/v1
      WOOPS_INTER_SERVICE_SECRET: woops_hmac_shared_secret_abcdef0123456789
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    networks:
      - woops-network

  workflow-engine:
    build:
      context: ./woops-workflow-engine/docker/images/n8n-custom
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: woops_n8n
      DB_POSTGRESDB_USER: woops
      DB_POSTGRESDB_PASSWORD: woops
      WOOPS_AGENT_ENGINE_URL: http://agent-engine:3000/api/v1
      WOOPS_INTER_SERVICE_SECRET: woops_hmac_shared_secret_abcdef0123456789
    ports:
      - "5678:5678"
    depends_on:
      - postgres
      - redis
    networks:
      - woops-network

networks:
  woops-network:
    driver: bridge

volumes:
  pgdata:
```

---

## 8. Definition of Done & Success Criteria

1. **Milestone 1 Success:** Jaafar receives a user question, plans `search_customer`, executes n8n workflow with signed HMAC headers, receives customer data, and responds with zero credential leakage.
2. **Milestone 2 Success:** A message sent from a real WhatsApp phone number reaches n8n, is forwarded to `POST /api/v1/channels/inbound`, triggers Jaafar, and returns an accurate WhatsApp reply in $< 2.5\text{s}$.
3. **Milestone 3 Success:** A refund action enters `WAITING` status, alerts a manager on Slack, and resumes execution seamlessly upon approval callback.
4. **Platform Guarantees:** 
   - Strict tenant isolation (`organizationId` validation).
   - Execution idempotency across network retries.
   - Total runtime replacability without modifying the core business model.
