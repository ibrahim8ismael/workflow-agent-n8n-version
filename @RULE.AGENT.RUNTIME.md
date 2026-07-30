# Woops AI Runtime Specification

> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

---

# 1. Overview

The Runtime is the execution engine of Woops.

Its responsibility is to orchestrate the execution of an AI Agent.

The Runtime connects every domain together while remaining completely independent from business logic.

The Runtime does not know how a company operates.

It only knows how to execute an Agent correctly.

---

# 2. Purpose

The Runtime exists to answer one question.

> "How should this request be executed?"

It never decides business rules.

It never contains company-specific logic.

It only orchestrates execution.

---

# 3. Runtime Philosophy

Woops Runtime is **NOT** an AI Framework.

Woops Runtime is **NOT** an LLM SDK.

Woops Runtime is an orchestration layer.

Business Intelligence belongs to

- Knowledge

Business Experience belongs to

- Memory

Business Capabilities belong to

- Skills

Business Decisions belong to

- Planner

Execution belongs to

- Runtime

---

# 4. Responsibilities

The Runtime is responsible for

- Loading the Agent
- Building execution context
- Calling the Planner
- Registering Tools
- Executing Tools
- Executing Skills
- Executing Workflows
- Retrieving Knowledge
- Retrieving Memory
- Managing Runs
- Handling Streaming
- Tracking Cost
- Tracking Usage
- Tracking Events
- Handling Errors
- Returning Responses

The Runtime is NOT responsible for

- Business Rules
- Company Policies
- OAuth
- Channel Logic
- Business Decisions
- Knowledge Management
- Memory Management

---

# 5. Runtime Architecture

```text
                    User
                      │
                      ▼
                    Run
                      │
                      ▼
                 Woops Runtime
                      │
 ┌────────────────────────────────────────────┐
 │                                            │
 │ Context Builder                            │
 │ Planner                                    │
 │ Tool Registry                              │
 │ Tool Executor                              │
 │ Skill Executor                             │
 │ Workflow Executor                          │
 │ Event Manager                              │
 │ AI Adapter                                 │
 │                                            │
 └────────────────────────────────────────────┘
                      │
                      ▼
               Vercel AI SDK
                      │
      ┌───────────────┼───────────────┐
      │               │               │
   OpenAI         Anthropic        Gemini
```

---

# 6. Runtime Principles

## Execution Only

The Runtime executes.

It never decides business logic.

---

## Stateless

The Runtime never stores business state.

Execution state belongs to the Run.

---

## Provider Agnostic

The Runtime never communicates directly with OpenAI,
Anthropic,
Gemini,
Groq,
or any provider.

All providers are accessed through the AI Adapter.

---

## Tool Driven

The Runtime exposes capabilities as Tools.

The AI never directly accesses services.

Everything passes through registered Tools.

---

## Simple

The Runtime should remain as thin as possible.

Business logic should never move into the Runtime.

---

# 7. Runtime Lifecycle

Receive Run

↓

Load Agent

↓

Build Context

↓

Call Planner

↓

Create Execution Plan

↓

Register Tools

↓

Call AI

↓

Tool Calls (Optional)

↓

Execute Skills

↓

Store Memory

↓

Generate Response

↓

Complete Run

---

# 8. Runtime Components

## Agent Loader

Loads

- Agent
- Configuration
- Instructions
- Enabled Skills

---

## Context Builder

Builds execution context.

Sources

- System Instructions
- Agent Instructions
- Knowledge
- Memory
- Conversation
- Current Request

Only relevant information should be loaded.

---

## Planner

Creates the execution plan.

The Runtime never plans.

It delegates planning.

---

## Tool Registry

Contains every Tool available to the Agent.

Examples

Search Knowledge

Search Memory

Execute Skill

Execute Workflow

Store Memory

Update Memory

Get Current Time

The Runtime decides which Tools exist.

---

## Tool Executor

Responsible for executing Tool calls.

Flow

LLM

↓

Tool Call

↓

Validate Tool

↓

Execute Tool

↓

Return Result

↓

LLM

The Runtime executes Tools.

The SDK only transports Tool Calls.

---

## Skill Executor

Responsible for executing Skills.

The Runtime never performs business logic.

Instead

Skill

↓

Execution

↓

Result

---

## Workflow Executor

Responsible for external workflow execution.

Current implementation

n8n

Future implementations

Custom Engine

Temporal

Other Workflow Engines

The Runtime should depend on an interface.

Never directly on n8n.

---

## Event Manager

Publishes runtime events.

Examples

Run Started

Tool Executed

Skill Completed

Workflow Started

Workflow Failed

Response Generated

Run Completed

---

## AI Adapter

The Runtime communicates with the AI Adapter.

Never directly with the SDK.

---

# 9. AI Adapter

The AI Adapter abstracts the SDK.

Responsibilities

Generate Text

Generate Objects

Stream Responses

Handle Provider Selection

Return Usage

Return Tool Calls

The rest of the Runtime should never know which SDK is used.

---

# 10. Vercel AI SDK

The Vercel AI SDK is an infrastructure dependency.

It provides

- Provider abstraction
- Streaming
- Structured output
- Tool calling protocol
- Provider integrations
- Usage information

The Runtime should never depend on SDK-specific APIs outside the AI Adapter.

---

# 11. Tool Rules

Every Tool must

Have a unique name

Have a description

Define input schema

Define output schema

Validate permissions

Return structured output

Never expose internal services directly.

---

# 12. Skill Rules

The Runtime executes Skills.

The Runtime never understands what the Skill does.

It only knows

Execute Skill

Receive Result

Continue Execution

---

# 13. Workflow Rules

Workflow execution belongs to external systems.

Current implementation

n8n

The Runtime only sends

Workflow Name

Input

Execution Context

The Runtime receives

Success

Failure

Output

The Runtime never executes workflows internally.

---

# 14. Knowledge Rules

The Runtime retrieves Knowledge.

It never indexes Knowledge.

It never modifies Knowledge.

Knowledge is read-only during execution.

---

# 15. Memory Rules

The Runtime may

Retrieve Memory

Store Memory

Update Memory

Delete Memory

The Runtime delegates these operations to the Memory domain.

---

# 16. Conversation Rules

The Runtime receives

Conversation

Messages

Attachments

The Runtime never owns conversations.

---

# 17. Streaming

Streaming belongs to the AI SDK.

The Runtime forwards streamed events.

The Runtime should never implement streaming itself.

---

# 18. Structured Outputs

Planning

Skill Selection

Tool Calls

Validation

should prefer structured JSON outputs.

Free-form responses should be minimized.

---

# 19. Error Handling

The Runtime should gracefully handle

Provider Errors

Workflow Errors

Tool Errors

Validation Errors

Timeouts

Network Errors

Unexpected Exceptions

Errors should always be structured.

---

# 20. Retry Strategy

Retry

Network Failure

Temporary Provider Failure

Temporary Workflow Failure

Do Not Retry

Permission Errors

Validation Errors

Business Rule Errors

Missing Inputs

---

# 21. Cost Tracking

The Runtime tracks

Prompt Tokens

Completion Tokens

Reasoning Tokens

Execution Duration

Workflow Count

Tool Count

Estimated Cost

AI Credits

Organization Usage

Provider usage comes from the SDK.

Business analytics belong to Woops.

---

# 22. Security

The Runtime should validate

Organization

Agent

Permissions

Enabled Skills

Enabled Tools

Available Integrations

before execution.

---

# 23. Observability

Every Run should expose

Timeline

Planner Duration

AI Duration

Workflow Duration

Tool Duration

Total Duration

Errors

Retries

Cost

Usage

---

# 24. Runtime Events

RunStarted

ContextBuilt

PlannerStarted

PlannerCompleted

ToolRegistered

ToolCalled

ToolCompleted

SkillStarted

SkillCompleted

WorkflowStarted

WorkflowCompleted

AIStarted

AICompleted

ResponseGenerated

MemoryStored

RunCompleted

RunFailed

---

# 25. Extension Points

The Runtime should allow replacing

AI Adapter

Workflow Engine

Tool Registry

Planner

Memory Provider

Knowledge Provider

without changing Runtime behavior.

---

# 26. Runtime Boundaries

The Runtime never owns

Business Logic

Pricing

Policies

Products

Services

Business Rules

OAuth

Channels

Provider SDK

The Runtime only orchestrates execution.

---

# 27. Design Rules

1. The Runtime is an orchestration layer.
2. The Runtime never contains business logic.
3. Every execution belongs to a Run.
4. Every Run passes through the Runtime.
5. The Planner creates plans; the Runtime executes them.
6. Skills implement business capabilities; the Runtime invokes them.
7. Workflows execute outside the Runtime.
8. The Runtime communicates with workflow engines through interfaces only.
9. The Runtime communicates with AI providers only through the AI Adapter.
10. The AI Adapter is the only component allowed to use the Vercel AI SDK.
11. The Runtime owns Tool registration and Tool execution.
12. The SDK transports Tool Calls; it does not execute business logic.
13. Knowledge is read-only during execution.
14. Memory operations are delegated to the Memory domain.
15. The Runtime validates permissions before execution.
16. Every execution should be observable.
17. Every execution should be measurable.
18. Every execution should be reproducible.
19. The Runtime should remain simple, provider-agnostic, and scalable.
20. The Runtime is the execution backbone of the Woops AI platform.




---


| Responsibility            | Vercel AI SDK    | Woops Runtime            |
| ------------------------- | ---------------- | ------------------------ |
| Multiple LLM Providers    | ✅                | ❌                        |
| Unified Provider API      | ✅                | ❌                        |
| Streaming Text            | ✅                | ❌                        |
| Streaming Objects         | ✅                | ❌                        |
| Structured Output         | ✅                | ❌                        |
| Tool Calling Protocol     | ✅                | ❌                        |
| Tool Registration         | ❌                | ✅                        |
| Tool Authorization        | ❌                | ✅                        |
| Tool Execution            | ⚠️ Requests Tool | ✅ Executes Tool          |
| Retry Provider Errors     | ✅ Basic          | ✅ Advanced Policies      |
| Abort / Cancel            | ✅                | ✅                        |
| Embeddings                | ✅                | ❌                        |
| Image Generation          | ✅                | ❌                        |
| AI Planning               | ❌                | ✅                        |
| Context Building          | ❌                | ✅                        |
| Memory Retrieval          | ❌                | ✅                        |
| Knowledge Retrieval       | ❌                | ✅                        |
| Skill Selection           | ❌                | ✅                        |
| Skill Execution           | ❌                | ✅                        |
| Workflow Execution (n8n)  | ❌                | ✅                        |
| Conversation State        | ❌                | ✅                        |
| Human Approval            | ❌                | ✅                        |
| Multi-Agent Orchestration | ❌                | ✅                        |
| Cost Tracking             | ⚠️ Usage Data    | ✅ Organization Analytics |
| Event Bus                 | ❌                | ✅                        |
| Observability             | ❌                | ✅                        |
