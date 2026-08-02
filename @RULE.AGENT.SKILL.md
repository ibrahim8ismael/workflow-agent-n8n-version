# Woops AI Skill Domain Specification

> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

---

# 1. Overview

A Skill is the smallest executable business capability inside Woops.

A Skill represents a reusable business function that an AI Agent can execute to achieve a specific goal.

A Skill is **NOT** a workflow.

A Skill is **NOT** a prompt.

A Skill is **NOT** a conversation.

A Skill is a capability.

Think about humans.

An employee has many skills.

Example

HR Employee

- Approve Leave
- Search Employee
- Create Offer Letter
- Process Payroll

Sales Employee

- Qualify Lead
- Create Deal
- Book Meeting
- Follow Up Customer

Support Employee

- Refund Customer
- Escalate Ticket
- Find FAQ
- Create Ticket

Exactly the same applies to AI Agents.

---

# 2. Philosophy

Agent = Employee

Skill = Capability

Run = Execution

Plan = Decision

Conversation = Trigger

Knowledge = Brain

Memory = Experience

n8n = External Worker

Vercel AI SDK = AI Runtime

---

# 3. Responsibilities

A Skill is responsible for

- Executing one business capability
- Defining its required inputs
- Defining expected outputs
- Defining validation rules
- Defining execution strategy
- Defining success criteria
- Returning deterministic results

A Skill is NOT responsible for

- OAuth
- Channels
- Runtime
- Memory Storage
- Knowledge Indexing
- Planning
- Conversation Management

---

# 4. Design Principles

## Principle 1

One Skill = One Responsibility

Never combine multiple unrelated business operations.

Good

Search Employee

Bad

Search Employee + Payroll + Leave Approval

---

## Principle 2

Reusable

Every Skill should be reusable by multiple Agents.

Example

Search Employee

Used by

HR Agent

CEO Agent

Payroll Agent

Support Agent

---

## Principle 3

Independent

A Skill should not know which Agent called it.

---

## Principle 4

Stateless

Skills never store execution state.

State belongs to Runs.

---

## Principle 5

Deterministic

Given identical inputs,

Skill should produce identical results whenever possible.

---

# 5. Skill Structure

Every Skill contains

Identity

Metadata

Instructions

Input Schema

Output Schema

Execution Strategy

Validation Rules

Dependencies

Policies

Configuration

Manifest

---

# 6. Skill Identity

Every Skill has

Skill ID

Name

Slug

Description

Category

Version

Owner

Visibility

Status

Tags

Created At

Updated At

---

# 7. Skill Categories

AI Skills

Business Skills

Search Skills

Decision Skills

Communication Skills

Retrieval Skills

Automation Skills

Human Approval Skills

Data Processing Skills

Integration Skills

---

Examples

Search Knowledge

Search CRM

Approve Leave

Create Invoice

Schedule Meeting

Generate Report

Find Employee

Book Interview

Send Offer

---

# 8. Skill Manifest

Every Skill must expose a manifest.

Example

Name

Description

Category

Version

Required Inputs

Optional Inputs

Expected Outputs

Permissions

Dependencies

Execution Mode

Timeout

Retry Policy

Success Criteria

Failure Conditions

---

# 9. Inputs

Every Skill defines required inputs.

Example

Approve Leave

Required

Employee ID

Leave Type

Start Date

End Date

Optional

Reason

Manager Comment

A Skill should never execute if required inputs are missing.

---

# 10. Input Collection

If inputs are missing

The Agent must collect them before execution.

Example

User

"I want vacation"

Planner

↓

Missing

Employee ID

Start Date

End Date

↓

Ask User

↓

Receive Answers

↓

Execute Skill

---

# 11. Outputs

Every Skill must define outputs.

Example

Approve Leave

Returns

Approval Status

Leave ID

Remaining Balance

Manager

Approval Timestamp

Outputs should always follow a schema.

---

# 12. Validation

Every Skill validates

Inputs

Outputs

Permissions

Dependencies

Business Rules

Never trust external systems.

---

# 13. Dependencies

A Skill may depend on

Knowledge

Memory

n8n Workflow

External API

Another Skill

Planner

Conversation Context

Dependencies must be declared explicitly.

---

# 14. Planning Metadata

Every Skill provides planning information.

Goal

Required Inputs

Missing Inputs

Success Criteria

Estimated Cost

Estimated Duration

Priority

Risk Level

Planner uses this information.

---

# 15. Execution Strategy

Execution may be

AI Only

n8n Workflow

Knowledge Retrieval

Memory Retrieval

Hybrid

Human Approval

Multiple Skills

---

Examples

Search FAQ

↓

Knowledge

Approve Leave

↓

n8n

Generate Summary

↓

LLM

Book Meeting

↓

Planner

↓

n8n

↓

Calendar

---

# 16. Skill Lifecycle

Draft

↓

Testing

↓

Published

↓

Active

↓

Deprecated

↓

Archived

Only Active Skills may execute.

---

# 17. Skill State

Skill itself has no runtime state.

Execution state belongs to Run.

Never store execution progress inside the Skill.

---

# 18. Skill Permissions

Skills may require

Organization Permission

Agent Permission

Human Approval

Role

Subscription Plan

Integration Availability

Channel Availability

---

# 19. Skill Policies

Every Skill defines

Security Rules

Retry Rules

Timeout Rules

Rollback Rules

Failure Rules

Approval Rules

---

# 20. Skill Events

SkillSelected

SkillStarted

SkillWaiting

SkillCompleted

SkillFailed

SkillCancelled

SkillRetried

SkillValidated

SkillSkipped

---

# 21. Skill Composition

A Plan may contain multiple Skills.

Example

Sales Agent

↓

Qualify Lead

↓

Search CRM

↓

Create Deal

↓

Book Meeting

↓

Generate Summary

Each Skill remains independent.

---

# 22. Skill Execution

Planner

↓

Choose Skill

↓

Validate Inputs

↓

Collect Missing Inputs

↓

Validate Permissions

↓

Validate Dependencies

↓

Execute

↓

Receive Result

↓

Validate Output

↓

Return Result

---

# 23. Integration Rules

Skills never implement OAuth.

Skills never store Tokens.

Skills never refresh Credentials.

Skills never authenticate APIs.

Instead

Skill asks

Is Integration Available?

YES

↓

Execute

NO

↓

Return Connection Required

---

# 24. Channel Rules

Skills never send messages directly.

Instead

Skill requests

Send Message

↓

n8n

↓

WhatsApp

Messenger

Slack

Email

Agent does not know channel implementation.

---

# 25. n8n Relationship

n8n is an execution provider.

Skills may invoke n8n.

n8n owns

OAuth

Credentials

API Keys

Connections

Triggers

Automation

Workflow Execution

Synchronization

Skill only receives

Execution Result

or

Execution Error

---

# 26. Knowledge Access

Skill may request

Search Documents

Find FAQ

Retrieve Policy

Find Employee Handbook

Knowledge remains read-only.

---

# 27. Memory Access

Skill may

Recall Memory

Store Memory

Update Memory

Forget Memory

Agent decides memory strategy.

Skill never owns Memory.

---

# 28. Error Handling

Possible errors

Missing Inputs

Permission Denied

Dependency Missing

Integration Missing

Execution Timeout

Validation Failed

Business Rule Failed

n8n Error

LLM Error

Unexpected Error

Errors should always be structured.

---

# 29. Retry Policy

Retry only when

Timeout

Temporary Failure

Network Error

Never retry

Validation Failure

Permission Denied

Missing Inputs

Business Rule Failure

---

# 30. Human Approval

Some Skills require approval.

Example

Terminate Employee

Refund $10,000

Delete Customer

Approve Payroll

Execution pauses until approval.

---

# 31. Success Criteria

Every Skill defines success.

Approve Leave

Success

Leave Approved

Balance Updated

Notification Sent

Failure

Manager Missing

Insufficient Balance

Employee Missing

---

# 32. Skill Contracts

Every Skill must expose

Input Contract

Output Contract

Error Contract

Permission Contract

Planning Contract

Execution Contract

Contracts never change without versioning.

---

# 33. Versioning

Breaking changes require a new version.

Agents may reference

Skill v1

Skill v2

Skill v3

without affecting other Agents.

---

# 34. Observability

Track

Execution Time

LLM Tokens

Cost

Retries

Errors

Success Rate

Latency

Tool Calls

n8n Calls

Memory Usage

Knowledge Retrieval

---

# 35. Design Rules

1. One Skill = One business capability.

2. Skills are reusable.

3. Skills are stateless.

4. Skills never own Memory.

5. Skills never own Knowledge.

6. Skills never own Conversations.

7. Skills never own Runs.

8. Skills never own OAuth.

9. Skills never own Channels.

10. Skills never own Integrations.

11. Planning happens before execution.

12. Missing inputs must be collected before execution.

13. Outputs must always be validated.

14. Every Skill exposes contracts.

15. Every Skill exposes planning metadata.

16. Skills communicate with external systems only through approved providers (currently n8n).

17. Skills never know how integrations work.

18. Skills never know how channels work.

19. Skills focus on business capabilities only.

20. A Skill is the fundamental building block of every AI Employee inside Woops.