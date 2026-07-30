# Woops AI Agent Domain Specification
> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

---

# 1. Overview

The Agent is the highest-level AI entity inside Woops.

An Agent represents an AI Employee that can reason, plan, orchestrate skills, use knowledge, access memory, communicate with users, and collaborate with external systems.

The Agent is **NOT**:

- A Prompt
- A Workflow
- A Chat Session
- A Runtime
- An LLM
- A Conversation

The Agent is a long-lived business object that owns its own identity, behavior, capabilities, and execution rules.

Every execution of an Agent creates a new **Run**.

---

# 2. Vision

Think of an Agent exactly as a human employee.

Example:

Organization
│
├── HR Agent
├── Sales Agent
├── Support Agent
├── Marketing Agent
├── Finance Agent
└── CEO Agent

Every employee has:

- Knowledge
- Memory
- Skills
- Goals
- Rules
- Permissions

The same applies to AI Agents.

---

# 3. Agent Responsibilities

The Agent is responsible for:

✓ Understanding user requests

✓ Planning execution

✓ Selecting Skills

✓ Building Context

✓ Retrieving Knowledge

✓ Recalling Memory

✓ Orchestrating Skill execution

✓ Validating results

✓ Generating final responses

✓ Learning from executions

The Agent is NOT responsible for:

✗ OAuth

✗ Integration Authentication

✗ Channel Authentication

✗ Workflow Execution Engine

✗ External API Authentication

✗ Streaming

✗ LLM SDK Communication

These responsibilities belong to other systems.

---

# 4. Agent Philosophy

The Agent is an AI Employee.

The Agent does not directly execute business logic.

Instead,

The Agent thinks.

The Agent plans.

The Agent orchestrates.

The Agent delegates execution to Skills.

Exactly like a human manager.

---

# 5. Core Principles

## Principle 1

Agent owns Skills.

Skills perform work.

---

## Principle 2

Agent owns Knowledge.

Skills consume Knowledge.

---

## Principle 3

Agent owns Memory.

Skills can update Memory.

---

## Principle 4

Agent never communicates directly with external systems.

Skills do.

---

## Principle 5

Agent never knows how OAuth works.

Agent only knows:

Integration Available

or

Integration Missing

---

## Principle 6

Agent never knows channel implementation.

Agent only knows

Can Send Message

or

Cannot Send Message

---

## Principle 7

Everything begins with a Plan.

No Skill may execute without a Plan.

---

## Principle 8

Every execution creates one Run.

Never reuse Runs.

---

# 6. Agent Identity

Every Agent has:

Agent ID

Organization ID

Name

Description

Avatar

Category

Status

Visibility

Version

Owner

Created At

Updated At

---

Agent Identity never changes.

Configuration may change.

---

# 7. Agent Configuration

Agent configuration includes

Model

Temperature

Max Tokens

Reasoning Mode

Planning Strategy

Response Style

Language

Timezone

Skill Selection Strategy

Memory Strategy

Knowledge Strategy

Retry Policy

Approval Policy

Safety Policy

Execution Limits

Context Limits

---

Configuration should never contain runtime state.

---

# 8. Agent Status

Draft

↓

Configured

↓

Published

↓

Active

↓

Paused

↓

Archived

Rules

Draft

Cannot execute.

Configured

Can be tested.

Published

Ready for production.

Paused

Rejects new Runs.

Archived

Read only.

---

# 9. Agent Lifecycle

Create

↓

Configure

↓

Attach Skills

↓

Attach Knowledge

↓

Configure Memory

↓

Publish

↓

Receive Requests

↓

Execute Runs

↓

Improve

↓

Archive

---

# 10. Agent Components

Agent consists of

Identity

Instructions

Planning Engine

Knowledge

Memory

Skills

Policies

Context Builder

Run Factory

Events

Configuration

The Agent does NOT include

OAuth

Channels

Integrations

Workflow Engine

Runtime SDK

---

# 11. Instructions

Instructions define the Agent personality.

Instructions define

Role

Responsibilities

Behavior

Goals

Restrictions

Writing Style

Decision Rules

Escalation Rules

Security Rules

Instructions never contain implementation logic.

---

# 12. Agent Goals

Every Agent should define

Primary Goal

Secondary Goals

Success Metrics

Failure Conditions

Examples

HR Agent

Primary Goal

Help employees.

Sales Agent

Primary Goal

Increase conversions.

Support Agent

Primary Goal

Resolve customer issues.

---

# 13. Agent Policies

Policies are deterministic rules.

Examples

Never expose secrets.

Never execute unavailable Skills.

Never fabricate Knowledge.

Never bypass validation.

Never ignore missing required inputs.

Always validate outputs.

Always cite Knowledge when required.

---

# 14. Planning System

Every request begins with Planning.

Planner responsibilities

Understand Intent

Determine Goal

Collect Missing Information

Choose Skills

Determine Execution Order

Estimate Success

Validate Plan

Only after planning

Execution may begin.

---

# 15. Plan

Plan is a temporary object.

Plan contains

Goal

Reasoning

Required Inputs

Missing Inputs

Execution Steps

Selected Skills

Expected Outputs

Validation Rules

Success Criteria

Risk Assessment

No Skill executes before Plan approval.

---

# 16. Skills

Workflow is renamed to Skill.

Reason

Employees have Skills.

Not Workflows.

Examples

HR Agent

Leave Approval Skill

Payroll Skill

Employee Search Skill

Recruitment Skill

Support Agent

Refund Skill

Ticket Skill

Escalation Skill

FAQ Skill

Sales Agent

CRM Lookup Skill

Lead Qualification Skill

Meeting Booking Skill

Deal Creation Skill

---

# 17. Skill Selection Rules

Agent never randomly selects Skills.

Selection depends on

Intent

Confidence

Required Inputs

Permissions

Dependencies

Availability

Execution Cost

Previous Results

---

# 18. Context Building

Before execution

Agent builds Context.

Context sources

System Instructions

Agent Instructions

Conversation

Memory

Knowledge

User Input

Previous Results

Context should be minimal.

Only relevant information is included.

---

# 19. Memory

Agent owns Memory.

Memory belongs to the Agent.

Not to Skills.

Memory Types

Session

Conversation

Customer

Agent

Organization

Long Term

Semantic

Skills may

Store

Recall

Update

Forget

Agent decides when Memory is used.

---

# 20. Knowledge

Knowledge belongs to Agent.

Skills consume Knowledge.

Knowledge Sources

PDF

Website

Database

FAQ

API

Text

Documentation

Knowledge is read-only during execution.

---

# 21. Conversation

Conversation is not the Agent.

Conversation triggers Agent execution.

Conversation provides

Messages

Attachments

Participants

Timeline

The Agent never owns Conversations.

---

# 22. Runs

Every request creates

ONE

Run.

Never reuse Runs.

Every Run belongs to

One Agent

One Conversation

One User

One Organization

---

# 23. Runtime

Woops uses

Vercel AI SDK

as the Runtime layer.

The Agent never communicates directly with

OpenAI

Anthropic

Gemini

Groq

Instead

Agent

↓

Planner

↓

Run

↓

AI Adapter

↓

Vercel AI SDK

↓

Provider

---

# 24. Integrations

The Agent does NOT manage integrations.

n8n owns

OAuth

API Keys

Credentials

Tokens

Refresh Tokens

Connection Status

Synchronization

The Agent only asks

Is CRM Connected?

YES

↓

Continue

NO

↓

Request Connection

---

# 25. Channels

Channels are NOT owned by the Agent.

n8n manages

WhatsApp

Messenger

Instagram

Slack

Telegram

Email

The Agent only knows

Available

Unavailable

The Agent never authenticates channels.

---

# 26. Skill Execution

User Message

↓

Plan

↓

Choose Skill

↓

Collect Missing Data

↓

Validate

↓

Execute Skill

↓

Need Integration?

↓

Call n8n

↓

Receive Result

↓

Generate Response

↓

Store Memory

↓

Finish Run

---

# 27. Safety Rules

Agent must never

Hallucinate business data

Invent integrations

Skip validation

Leak secrets

Execute unavailable Skills

Ignore missing permissions

Ignore policy violations

---

# 28. Events

AgentCreated

AgentUpdated

AgentPublished

AgentActivated

AgentPaused

AgentArchived

PlanGenerated

SkillSelected

SkillExecuted

KnowledgeRetrieved

MemoryUpdated

RunStarted

RunCompleted

RunFailed

---

# 29. Design Rules

1. Agent is a business object.

2. Agent is never a workflow.

3. Skills execute work.

4. Agent orchestrates Skills.

5. Every execution creates a Run.

6. Planning always comes before execution.

7. Memory belongs to Agent.

8. Knowledge belongs to Agent.

9. Conversations trigger Runs.

10. Vercel AI SDK is the AI runtime.

11. n8n owns integrations.

12. n8n owns OAuth.

13. n8n owns channels.

14. Agent only consumes integration/channel availability.

15. Agent never knows implementation details.

16. Every decision must be explainable.

17. Every response must originate from a valid execution plan.

18. Skills are reusable across multiple Agents.

19. The Agent is an orchestrator, not an executor.

20. The Agent is the digital employee; Skills are its capabilities; Runs are its executions.