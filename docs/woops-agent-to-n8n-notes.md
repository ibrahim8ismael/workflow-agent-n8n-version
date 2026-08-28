Woops — Agent Engine ↔ n8n Architecture Notes

Purpose

These notes capture the architectural decisions and implementation changes discussed for integrating the Woops Agent Engine with the n8n Workflow Engine, while keeping Woops focused on the AI Employee product rather than becoming a generic agent-runtime platform.

The existing wiring plan remains the target architecture. These notes define the changes recommended for the MVP and the boundaries that should remain stable as the system grows.

1. Core Product Direction

Woops should not position itself as:

A generic platform for building AI agents.

The stronger product direction is:

An AI Employee platform for businesses.

The product owns the business layer around an AI employee:

Employee identity and role

Skills

Knowledge

Memory

Permissions

Policies

Conversations

Runs

Business context

Integrations

Analytics

Human escalation

The underlying agent/workflow runtime should remain replaceable.

Architectural principle

Woops owns the business layer; runtimes provide execution capabilities.

This means Hermes, OpenClaw, LangGraph, n8n, or another runtime can potentially be used underneath Woops without replacing the Woops product itself.

2. Target Architecture

                         WOOPS
                           │
                  AI Employee Platform
                           │
             ┌─────────────┴─────────────┐
             │                           │
      Business / Brain Layer       Execution Layer
             │                           │
     Employee / Skills             Skill Executor
     Knowledge / Memory                 │
     Policies / Permissions       ┌──────┼─────────┐
     Conversations / Runs         │      │         │
     Planning                     n8n   Native   Future
             │                           │
             └──────────────┬────────────┘
                            │
                     External Systems

The important boundary is:

Woops = business intelligence + orchestration
n8n   = external integration + deterministic execution

3. Agent Engine vs Workflow Engine

Woops Agent Engine — Brain

The Agent Engine owns:

AI Employee identity

Planning

Reasoning

Memory

Knowledge retrieval

Conversation orchestration

Agent runs

Skills

Permissions

Tenant isolation

Business state

Agent context

The Agent Engine should not directly manage third-party OAuth credentials or provider-specific API authentication.

n8n Workflow Engine — Muscle

n8n owns:

Third-party integrations

OAuth credential storage

API keys

Provider-specific APIs

Webhook/provider ingestion

Deterministic workflows

External API execution

Channel-specific provider handling

This preserves the zero-credential-leakage boundary from the original wiring plan.

4. Important Rule: The Agent Must Not Know About n8n

The LLM and planner should reason about business capabilities, not implementation details.

Good

{
  "name": "search_customer",
  "description": "Find a customer by email",
  "inputSchema": {},
  "outputSchema": {}
}

Bad

{
  "skill": "hubspot-search-v1",
  "executionEngine": "n8n",
  "workflowId": "123"
}

The planner should only see the Skill abstraction.

Internally:

Agent
  ↓
Skill: search_customer
  ↓
Skill Registry
  ↓
Execution Adapter
  ↓
n8n workflow
  ↓
HubSpot

This prevents the agent architecture from becoming coupled to n8n.

5. Skill Execution Must Be an Abstraction

A Skill is a business capability.

The Skill should not equal an n8n workflow.

Recommended execution modes:

NATIVE
N8N
HTTP
ASYNC

Example:

Skill
 ├── name
 ├── description
 ├── inputSchema
 ├── outputSchema
 ├── permissions
 ├── requiredIntegrations
 └── executionMode

Possible implementation:

search_customer
      ↓
N8N

calculate_discount
      ↓
NATIVE

external_api_lookup
      ↓
HTTP

manager_approval
      ↓
ASYNC

This prevents Woops from being permanently locked to n8n.

6. Recommended Skill Execution Flow

Jaafar
  ↓
Planner
  ↓
Plan Step
  ↓
Skill
  ↓
Skill Executor
  ↓
Execution Adapter
  ↓
n8n
  ↓
External Integration
  ↓
Structured Result
  ↓
Run Context
  ↓
Jaafar

The Agent Engine should own the execution lifecycle.

n8n should execute the external operation.

7. Zero Credential Leakage

Third-party credentials must remain outside the Agent Engine.

Never expose these to the LLM:

OAuth access tokens

OAuth refresh tokens

API keys

Client secrets

Provider credentials

Correct flow:

Jaafar
  ↓
search_customer
  ↓
Woops Skill Executor
  ↓
n8n
  ↓
Stored HubSpot Credential
  ↓
HubSpot
  ↓
Result

Incorrect flow:

Jaafar
  ↓
LLM receives HubSpot token
  ↓
LLM calls HubSpot directly

Logs, traces, prompts, memory, and conversation history must also avoid storing raw credentials.

8. Inter-Service Security

The original plan proposes HMAC-SHA256 between Agent Engine and Workflow Engine.

Recommended request signature:

HMAC-SHA256(
  secret,
  timestamp + "." +
  HTTP_METHOD + "." +
  PATH + "." +
  rawBody
)

Headers:

X-Woops-Signature
X-Woops-Timestamp

Use a replay protection window.

Recommended default:

300 seconds

The shared secret must be stored only in service configuration/secrets management.

9. Idempotency

Idempotency is especially important for business side effects.

Examples:

Send email

Send WhatsApp message

Create order

Issue refund

Create CRM record

Charge customer

Do not rely only on:

runId + skillSlug + stepOrder

Prefer a stable execution identity based on the actual plan step, for example:

runId + planStepId + skillVersion

The system should persist idempotency state:

PROCESSING
SUCCEEDED
FAILED
EXPIRED

A retry caused by a network failure must not accidentally execute the business side effect twice.

10. Inbound Channel Architecture

For the MVP, n8n can remain responsible for provider-specific ingestion.

Example:

WhatsApp
   ↓
n8n Webhook
   ↓
Normalize Provider Payload
   ↓
WoopsChannelMessage
   ↓
Agent Engine
   ↓
Conversation Engine
   ↓
Agent Run
   ↓
Response
   ↓
n8n
   ↓
WhatsApp

However, the Agent Engine should not become coupled to individual channel implementations.

Recommended conceptual layers:

Channel Gateway
      ↓
Message Ingestion
      ↓
Conversation Engine
      ↓
Agent Run
      ↓
Response Event
      ↓
Channel Gateway

This keeps the architecture open for:

WhatsApp

Telegram

Slack

Email

Web

API

Future channels

11. Source of Truth

A critical boundary:

n8n is an execution system, not the source of truth for Woops business state.

Woops owns

Organizations

Users

Employees

Agents

Skills

Conversations

Messages

Runs

Plans

Memory

Knowledge

Permissions

Integration state

Execution state

Business configuration

n8n owns

OAuth credentials

Provider credentials

Provider-specific webhook handling

External API execution

Deterministic workflow execution

Integration-specific implementation details

12. Async Execution and Human-in-the-Loop

The target architecture supports asynchronous execution.

Example:

Agent
  ↓
Skill
  ↓
n8n
  ↓
WAITING_FOR_APPROVAL
  ↓
Human
  ↓
n8n callback
  ↓
Agent Engine
  ↓
Resume Run
  ↓
Continue Plan

The Agent Engine owns the Run state.

Example states:

RUNNING
WAITING
COMPLETED
FAILED
CANCELLED

Callbacks must be authenticated and idempotent.

13. MVP Implementation Strategy

Do not implement the entire target architecture before validating the vertical slice.

The original plan contains:

Inter-service security

Shared DTOs

Outbound execution

Dynamic skill registry

Retry and circuit breakers

Multi-channel ingestion

Async callbacks

Human-in-the-loop

Catalog synchronization

Docker integration

Full E2E testing

These are valid production requirements, but implementing all of them immediately creates unnecessary infrastructure work.

MVP principle

Build one complete AI Employee workflow from end to end before expanding the infrastructure.

14. MVP Vertical Slice

Start with one employee:

Jaafar — Customer Support Employee

Start with one real business capability:

search_customer

Example:

Customer
  ↓
Jaafar
  ↓
"Find the customer with email x@example.com"
  ↓
Planner
  ↓
search_customer Skill
  ↓
Agent Skill Executor
  ↓
n8n
  ↓
HubSpot
  ↓
Customer Data
  ↓
Agent Run Context
  ↓
Jaafar
  ↓
Customer-facing response

This proves the most important architecture:

AI → Skill → n8n → External API → Result → AI

15. MVP Phase 1 — Outbound Skill Execution

Implement only:

Skill contract

Skill registry

n8n execution adapter

HMAC authentication

Request timeout

Retry policy

Idempotency

Structured errors

Basic telemetry

Do not implement every possible integration.

Use one real integration first.

16. MVP Phase 2 — One Channel

After outbound execution works, add one channel.

Recommended first channel:

WhatsApp

Flow:

WhatsApp
  ↓
n8n
  ↓
/api/v1/channels/inbound
  ↓
Conversation
  ↓
Jaafar
  ↓
Skill
  ↓
n8n
  ↓
External System
  ↓
Jaafar Response
  ↓
n8n
  ↓
WhatsApp

Do not build WhatsApp + Telegram + Slack + Email simultaneously.

17. MVP Phase 3 — Async

Only after synchronous execution is stable:

Run checkpoints

WAITING state

Callback endpoint

Resume logic

Human approval workflow

Example:

Jaafar
  ↓
refund_customer
  ↓
n8n
  ↓
WAITING
  ↓
Manager Approval
  ↓
Callback
  ↓
Resume Run

18. Production Phase — Later

After the vertical slice proves value, add:

Dynamic skill catalog

Integration readiness checks

Multiple channels

Circuit breakers

Advanced telemetry

Workflow schema synchronization

Full E2E testing

Advanced retry policies

Operational dashboards

These belong to the target architecture, not the first validation milestone.

19. Runtime Independence

Woops should not make its product value dependent on owning a proprietary agent runtime.

The runtime should be replaceable.

Potential execution/runtime components:

Woops Business Layer
        ↓
Skill Execution Interface
        ↓
 ┌──────┼─────────┐
 │      │         │
 n8n   Native   Future Runtime

If another open-source runtime becomes better for a specific workload, Woops should be able to integrate it without redesigning the business layer.

This is especially important because agent runtimes, memory systems, tool calling, and planning infrastructure are evolving quickly.

20. Architecture Decision

Decision

Keep n8n as the initial Workflow/Integration Engine.

Do not replace it because another agent runtime exists.

Instead:

Keep Woops as the AI Employee/business layer.

Keep n8n as the initial external integration execution layer.

Hide n8n behind a Skill Execution abstraction.

Keep credentials inside n8n.

Keep business state inside Woops.

Avoid building a proprietary runtime unless there is a validated product reason.

Keep the execution layer replaceable.

21. Definition of the First Milestone

The first milestone is not:

Complete runtime

Complete channel system

Complete integration catalog

Complete n8n platform

Multi-agent system

Perfect planner

The first milestone is:

Jaafar successfully completes one real business task through an n8n-backed Skill from end to end.

Success example:

User
  ↓
Jaafar
  ↓
Planner
  ↓
search_customer
  ↓
Woops Agent Engine
  ↓
n8n
  ↓
HubSpot
  ↓
Structured Result
  ↓
Jaafar
  ↓
Useful Response

Once this works reliably with a real business use case, expand the platform.

22. Strategic Principle

The main strategic lesson is:

Do not compete with agent runtimes on infrastructure if Woops can create more value by sitting above them.

Woops should sell the outcome:

AI Employees that perform real business work.

The customer should not need to care whether the underlying execution uses n8n, Hermes, OpenClaw, LangGraph, or another runtime.

The customer cares that the employee:

Understands the business

Has the right knowledge

Can use the right tools

Has controlled permissions

Completes real work

Escalates when necessary

Remembers relevant context

Produces measurable business value

23. Final Architecture Direction

                         WOOPS
                           │
                   AI EMPLOYEE OS
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    Employee             Skills           Business
    Identity            & Tools             Context
        │                  │                  │
        ├──────────────┬───┴───────┬──────────┤
        │              │           │
     Knowledge       Memory     Permissions
        │              │           │
        └──────────────┼───────────┘
                       │
                    Planner
                       │
                   Agent Run
                       │
                Skill Executor
                       │
             ┌─────────┼─────────┐
             │         │         │
            n8n       Native    Future
             │         │       Runtime
             └─────────┼─────────┘
                       │
                External Systems

This should be treated as the target architecture. The MVP should implement only the smallest vertical slice through this architecture.