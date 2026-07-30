# Woops AI Run Engine Specification

> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

---

# 1. Overview

A Run represents **one complete execution** of an AI Agent.

Every interaction with an Agent creates a brand new Run.

A Run is temporary.

It exists only during execution and becomes immutable after completion.

Think of a Run as a transaction.

Just as every payment creates a new transaction, every Agent execution creates a new Run.

---

# 2. Philosophy

Agent = Employee

Skill = Capability

Plan = Strategy

Run = Work Session

Conversation = Trigger

Memory = Experience

Knowledge = Information

A Run is not the Agent.

A Run is the execution of the Agent.

---

# 3. Responsibilities

The Run is responsible for:

- Executing one request
- Building execution context
- Managing execution state
- Tracking every event
- Coordinating the Planner
- Coordinating Skill execution
- Managing AI reasoning
- Managing retries
- Managing failures
- Tracking token usage
- Tracking execution cost
- Producing the final response

The Run is NOT responsible for:

- Owning Memory
- Owning Knowledge
- Managing OAuth
- Managing Channels
- Managing Integrations
- Storing Agent configuration

---

# 4. Core Principles

## Principle 1

One request = One Run

Never reuse a Run.

---

## Principle 2

Runs are immutable after completion.

---

## Principle 3

Runs own execution state.

The Agent never owns execution state.

---

## Principle 4

Every decision must be traceable.

---

## Principle 5

Everything inside the Run is event-driven.

---

# 5. Run Identity

Every Run contains

Run ID

Agent ID

Organization ID

Conversation ID

User ID

Plan ID

Status

Started At

Completed At

Duration

Version

---

# 6. Run Lifecycle

```text
Created

↓

Preparing Context

↓

Planning

↓

Validating

↓

Executing Skills

↓

Waiting

↓

Generating Response

↓

Persisting Memory

↓

Completed

or

Failed

or

Cancelled
```

---

# 7. Run States

## Created

Run exists but nothing has started.

---

## Preparing Context

Building the execution context.

Loading

- Agent
- Memory
- Knowledge
- Conversation
- Variables

---

## Planning

Planner analyzes the request.

Planner determines

- Goal
- Required Skills
- Missing Inputs
- Success Criteria

---

## Validating

Checks

- Agent Status
- Permissions
- Required Inputs
- Integration Availability
- Channel Availability
- Skill Availability

---

## Executing

Execute one or more Skills.

---

## Waiting

Run is paused.

Reasons

Human Approval

Missing User Input

Long Running Skill

External Workflow

---

## Generating Response

Generate final response using Vercel AI SDK.

---

## Persisting Memory

Store

Conversation Summary

Learned Facts

Execution Result

Long-term Memory

---

## Completed

Execution finished successfully.

---

## Failed

Execution cannot continue.

---

## Cancelled

Execution intentionally stopped.

---

# 8. Run Components

Every Run contains

Planner

Execution Context

Execution State

Execution Events

Skill Queue

AI Adapter

Metrics

Cost Tracker

Observability

---

# 9. Context Builder

Before execution

Run builds Context.

Sources

System Prompt

↓

Agent Instructions

↓

Skill Instructions

↓

Conversation

↓

Memory

↓

Knowledge

↓

User Message

↓

Variables

Only relevant data is included.

---

# 10. Planner

The Planner creates a Plan.

Responsibilities

Understand Intent

Determine Goal

Choose Skills

Determine Order

Collect Missing Inputs

Estimate Success

Risk Analysis

No Skill executes before planning completes.

---

# 11. Plan

The Run owns one Plan.

The Plan contains

Goal

Intent

Selected Skills

Execution Order

Dependencies

Required Inputs

Expected Outputs

Validation Rules

Success Criteria

Risk Assessment

---

# 12. Skill Queue

The Planner creates a queue.

Example

Search Employee

↓

Check Leave Balance

↓

Approve Leave

↓

Notify Employee

↓

Store Memory

The Run executes the queue sequentially unless parallel execution is allowed.

---

# 13. Execution Rules

A Skill executes only when

Inputs complete

Permissions valid

Dependencies available

Plan approved

Agent active

Skill active

---

# 14. AI Runtime

Woops uses

Vercel AI SDK

as the AI Runtime.

The Run never communicates directly with

OpenAI

Anthropic

Gemini

Groq

Instead

Run

↓

AI Adapter

↓

Vercel AI SDK

↓

Provider

---

# 15. Skill Execution

Run

↓

Execute Skill

↓

Need External Workflow?

↓

YES

↓

Call n8n

↓

Receive Result

↓

Validate Result

↓

Continue

NO

↓

Continue

---

# 16. n8n Responsibility

The Run never manages

OAuth

Credentials

Tokens

Connections

Channels

Workflow Engine

Automation

The Run only receives

Execution Result

Execution Error

Connection Required

---

# 17. Integration Availability

Before executing a Skill

Run asks

Is Integration Connected?

YES

↓

Continue

NO

↓

Return Required Connection

The Run never attempts OAuth.

---

# 18. Channel Availability

Before sending messages

Run asks

Is Channel Available?

YES

↓

Continue

NO

↓

Return Channel Unavailable

---

# 19. Human Approval

The Run may pause.

Example

Approve Payroll

↓

Waiting For Approval

↓

Approved

↓

Continue

or

Rejected

↓

Cancelled

---

# 20. Error Handling

Possible failures

Missing Inputs

Permission Denied

Validation Failed

Skill Failure

Planner Failure

Knowledge Failure

Memory Failure

LLM Failure

n8n Failure

Timeout

Unexpected Error

---

# 21. Retry Strategy

Retry only

Network Errors

Timeouts

Temporary Provider Failure

Do NOT retry

Permission Errors

Validation Errors

Missing Inputs

Business Rule Failures

---

# 22. Memory Updates

Memory updates happen only after successful execution.

Store

Conversation Summary

Important Facts

User Preferences

Business Results

Agent Learning

The Run never directly owns Memory.

---

# 23. Knowledge Access

Knowledge is read-only.

Run may

Retrieve Documents

Search Policies

Retrieve FAQ

Retrieve Files

Knowledge is never modified during execution.

---

# 24. Streaming

Streaming is handled entirely by

Vercel AI SDK.

The Run simply consumes streamed events.

---

# 25. Metrics

Track

Execution Time

Planner Time

Skill Time

Knowledge Time

Memory Time

LLM Time

n8n Time

Waiting Time

Response Time

---

# 26. Cost Tracking

Track

Prompt Tokens

Completion Tokens

Reasoning Tokens

Embedding Tokens

Model Cost

Workflow Cost

Execution Cost

Total Cost

---

# 27. Events

RunCreated

ContextPrepared

PlanningStarted

PlanCreated

ValidationCompleted

SkillQueued

SkillStarted

SkillCompleted

SkillFailed

SkillWaiting

MemoryRetrieved

KnowledgeRetrieved

LLMStarted

LLMCompleted

ResponseGenerated

MemoryStored

RunCompleted

RunFailed

RunCancelled

---

# 28. Observability

Every Run must be fully traceable.

Track

Timeline

State Changes

Planner Decisions

Skill Decisions

Tool Calls

n8n Calls

AI Requests

Errors

Retries

Latency

Every event should include timestamps.

---

# 29. Future Capabilities

Future versions of the Run Engine may support

- Parallel Skill execution
- Distributed Runs
- Child Runs
- Multi-Agent collaboration
- Agent-to-Agent delegation
- Scheduled Runs
- Background Runs
- Resumable Runs
- Run snapshots
- Deterministic replay

---

# 30. Design Rules

1. Every request creates exactly one Run.
2. Runs are immutable after completion.
3. Runs own execution state.
4. The Agent never owns execution state.
5. Every Run creates one execution Plan.
6. Planning always happens before execution.
7. Every Skill execution belongs to one Run.
8. Memory belongs to the Agent, not the Run.
9. Knowledge belongs to the Agent, not the Run.
10. OAuth is never handled by the Run.
11. Channels are never handled by the Run.
12. Integrations are delegated to n8n.
13. AI inference is delegated to Vercel AI SDK.
14. Every state transition must emit an event.
15. Every execution must be observable.
16. Every decision must be traceable.
17. Every failure must be recoverable or explainable.
18. The Run is the transactional execution boundary of the Woops AI platform.