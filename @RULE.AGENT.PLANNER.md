# Woops AI Planner Domain Specification

> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

---

# 1. Overview

The Planner is the decision engine of an AI Agent.

Its responsibility is to understand the user's objective and create an execution plan before any Skill is executed.

The Planner never performs business operations.

Instead, it decides **what should happen next**.

Every Agent execution starts with the Planner.

---

# 2. Purpose

The Planner exists to answer one question.

> "What is the best way to complete this request?"

It does not execute.

It decides.

---

# 3. Philosophy

An AI Employee should never immediately execute the first thing it thinks about.

A good employee

- understands the request
- collects missing information
- checks business rules
- chooses the correct process
- then starts working

The Planner follows exactly the same behavior.

---

# 4. Responsibilities

The Planner is responsible for

- Understanding the user's intent
- Understanding the business context
- Choosing the correct Skill
- Detecting missing information
- Validating execution requirements
- Building an execution plan

The Planner is NOT responsible for

- Executing Skills
- Managing Memory
- Managing Knowledge
- Managing Conversations
- Managing Integrations
- Calling APIs
- Calling n8n
- Generating the final response

---

# 5. Planner Principles

## Think Before Execute

Every request must be planned before execution.

Never execute first.

---

## Business Aware

Planning should always consider

- Business Model
- Policies
- Products
- Services
- Organization Rules

---

## Never Guess

If required information is missing,

ask the user.

Never invent information.

---

## Choose Existing Skills

The Planner should always reuse existing Skills.

It should never create new business logic during execution.

---

## Keep Plans Simple

The Planner should generate the smallest possible execution plan.

Avoid unnecessary Skills.

---

# 6. Planner Input

The Planner receives

- User Request
- Conversation
- Agent Configuration
- Knowledge Base
- Memory
- Available Skills

---

# 7. Planner Output

The Planner produces an Execution Plan.

Example

```text
Goal:
Approve employee leave

Skills

1. Search Employee
2. Check Leave Balance
3. Approve Leave
4. Notify Employee

Missing Inputs

Employee ID

Success Criteria

Leave approved successfully
```

---

# 8. Planning Lifecycle

Receive Request

↓

Understand Intent

↓

Load Context

↓

Retrieve Business Knowledge

↓

Retrieve Relevant Memory

↓

Identify Goal

↓

Choose Skills

↓

Check Missing Inputs

↓

Validate Requirements

↓

Create Plan

↓

Return Plan

---

# 9. Understand Intent

The first responsibility is understanding what the user actually wants.

Examples

User

"I need next week off."

Intent

Request Leave

---

User

"I want to refund my order."

Intent

Refund Request

---

User

"Book a meeting with Ahmed."

Intent

Schedule Meeting

The Planner should focus on the goal, not the wording.

---

# 10. Business Context

Before choosing a Skill,

the Planner should understand

- Business Type
- Organization Rules
- Business Policies
- Available Products
- Services

Business context always comes from the Knowledge Base.

---

# 11. Skill Selection

The Planner chooses one or more Skills.

Example

User

"I want to change my subscription."

Planner

↓

Find Customer

↓

Retrieve Subscription

↓

Change Subscription

↓

Notify Customer

The Planner should always reuse Skills.

---

# 12. Missing Information

If execution requires missing data,

the Planner should pause.

Example

"I want vacation."

Missing

Employee ID

Start Date

End Date

The Planner should ask for the missing information before execution.

---

# 13. Validation

Before execution,

the Planner validates

- Skill exists
- Skill enabled
- Agent active
- Required inputs available
- Required Knowledge available
- Integration available (if needed)
- Channel available (if needed)

If validation fails,

execution should not begin.

---

# 14. Knowledge Rules

Whenever business-specific information is required,

the Planner should retrieve it from the Knowledge Base.

Examples

Pricing

Refund Policy

Leave Policy

Business Hours

Company Products

The Planner must never assume business information.

---

# 15. Memory Rules

The Planner may retrieve Memory to improve execution.

Examples

Preferred Language

Customer Preferences

Previous Decisions

Memory should never override Knowledge.

---

# 16. Execution Plan

Every Plan contains

Goal

Selected Skills

Execution Order

Missing Inputs

Validation Result

Business Context

Expected Result

---

# 17. Skill Ordering

Skills should execute in logical order.

Bad

Approve Leave

↓

Find Employee

Good

Find Employee

↓

Check Leave Balance

↓

Approve Leave

↓

Notify Employee

---

# 18. Multi Skill Planning

Some requests require multiple Skills.

Example

New Employee Onboarding

↓

Create Employee

↓

Create Email

↓

Assign Equipment

↓

Notify Manager

The Planner decides the sequence.

---

# 19. Single Skill Planning

Some requests only require one Skill.

Example

"What are your working hours?"

↓

Search Knowledge

The Planner should not overcomplicate simple requests.

---

# 20. Trigger Planning

Planning works the same regardless of execution source.

Execution Sources

Conversation

API

Manual

n8n Trigger

Scheduler

Another Agent

Every execution passes through the Planner.

---

# 21. Integration Rules

The Planner never performs OAuth.

The Planner never manages credentials.

If a Skill requires an Integration,

the Planner only checks whether the Integration is available.

If unavailable,

execution should stop and request a connection.

---

# 22. Channel Rules

The Planner never sends messages.

It only determines whether a Skill requires a communication channel.

Channel execution belongs to the execution layer.

---

# 23. Error Rules

Planning should fail when

No Skill matches

Missing required information

Business knowledge unavailable

Agent disabled

Skill disabled

Permission denied

The Planner should return structured errors.

---

# 24. Success Criteria

Planning succeeds when

- Goal identified
- Skills selected
- Missing inputs collected
- Validation completed
- Execution Plan created

Only then may execution begin.

---

# 25. What the Planner Must Never Do

The Planner must never

- Execute Skills
- Modify Memory
- Modify Knowledge
- Invent business information
- Skip validation
- Skip missing inputs
- Ignore organization policies
- Hardcode business logic

---

# 26. Future Roadmap

The MVP Planner intentionally remains simple.

Future versions may support

- Parallel execution
- Cost optimization
- Dynamic replanning
- Conditional execution
- Agent delegation
- Multi-agent planning
- Background planning

These capabilities are intentionally excluded from the MVP.

---

# 27. Design Rules

1. Every Run starts with the Planner.
2. The Planner understands before executing.
3. The Planner chooses Skills, never executes them.
4. Every execution requires a Plan.
5. Missing information must be collected before execution.
6. Business knowledge must come from the Knowledge Base.
7. Memory is optional and only provides additional context.
8. Knowledge always has higher priority than Memory.
9. Skills contain business capabilities, not business decisions.
10. The Planner always reuses existing Skills.
11. Integrations and Channels are validated, not managed.
12. Every plan should be as simple as possible.
13. The Planner must never invent business information.
14. A successful Plan is the only valid input for the execution phase.