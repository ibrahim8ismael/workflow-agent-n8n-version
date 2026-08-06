# Woops LLM Runtime Specification

> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

---

# 1. Overview

The LLM Runtime is responsible for executing every AI request inside Woops.

It provides a unified interface between the Agent Runtime and multiple AI providers.

The Runtime abstracts providers, models, and SDK implementations, allowing the Agent to remain completely provider-independent.

---

# 2. Philosophy

The Agent should never know

- Which provider is being used
- Which model is being used
- How the request is executed

The Agent only defines the required execution quality.

The Runtime is responsible for selecting the appropriate provider and model.

---

# 3. Goals

The LLM Runtime exists to

- Support multiple AI providers
- Eliminate vendor lock-in
- Optimize execution cost
- Improve reliability
- Automatically recover from provider failures
- Allow model upgrades without modifying Agents

---

# 4. Architecture

```
Agent

↓

Woops Runtime

↓

LLM Runtime

↓

AI Provider Adapter

↓

Provider

↓

Model
```

The Agent never communicates directly with any provider.

---

# 5. Supported Providers

The Runtime should support multiple providers.

Examples

- OpenAI
- OpenRouter
- Anthropic
- Google AI
- xAI (Grok)
- Azure OpenAI
- Ollama
- LM Studio

Future providers should be added without changing Agent logic.

---

# 6. Provider Independence

The Agent must never contain

Provider Names

Model Names

SDK References

Provider APIs

Provider-specific Parameters

Everything must pass through the Runtime abstraction.

---

# 7. AI Execution Modes

The Agent does not choose a model.

Instead, it chooses an execution mode.

For MVP the Runtime supports three execution modes.

- Low
- Medium
- High

These modes represent execution quality, not specific models.

---

# 8. Low Mode

Purpose

Provide the fastest execution with the lowest possible cost.

Recommended for

- Classification
- Routing
- Short Responses
- Data Extraction
- Simple Business Tasks

Priority

Speed

↓

Cost

↓

Quality

---

# 9. Medium Mode

Purpose

Provide balanced execution.

Recommended for

- Customer Support
- Sales
- Workflow Generation
- Business Automation
- Daily Operations

Priority

Quality

↓

Speed

↓

Cost

---

# 10. High Mode

Purpose

Provide maximum reasoning quality.

Recommended for

- Complex Planning
- Long Conversations
- Advanced Analysis
- Large Workflow Generation
- Critical Business Operations

Priority

Quality

↓

Accuracy

↓

Cost

---

# 11. Model Resolution

Execution always follows this flow.

```
Execution Mode

↓

Runtime

↓

Provider

↓

Model

↓

Execution
```

The Agent never selects a model directly.

---

# 12. Model Registry

Every provider exposes one or more models.

Example

OpenAI

- GPT-5
- GPT-5 Mini

Google

- Gemini Flash
- Gemini Pro

Anthropic

- Claude Sonnet
- Claude Opus

OpenRouter

- Multiple Third-party Models

The Runtime maintains the registry.

---

# 13. Runtime Responsibilities

The Runtime is responsible for

- Provider Selection
- Model Selection
- Request Formatting
- Streaming
- Structured Output
- Tool Calling
- Retry
- Timeout Handling
- Usage Collection
- Cost Tracking

The Runtime is NOT responsible for

- Business Logic
- Planning
- Knowledge
- Memory
- Skills

---

# 14. Provider Selection

The Runtime selects the provider based on

- Execution Mode
- Organization Configuration
- Provider Availability
- Cost
- Performance
- Rate Limits
- Health Status

The Agent is unaware of this process.

---

# 15. Model Selection

Models should never be hardcoded inside Agents.

Example

Today

Low

↓

Gemini Flash

Six months later

Low

↓

GPT-5 Nano

No Agent changes are required.

---

# 16. Provider Failover

If a provider becomes unavailable,

the Runtime should automatically attempt another provider.

Example

OpenAI

↓

Unavailable

↓

OpenRouter

↓

Equivalent Model

↓

Continue Execution

The Agent should not notice the provider change.

---

# 17. Request Lifecycle

Execution starts

↓

Runtime receives request

↓

Resolve execution mode

↓

Select provider

↓

Select model

↓

Send request

↓

Receive response

↓

Return result

---

# 18. Streaming

Streaming is provided by the underlying provider SDK.

The Runtime should

- Start streaming
- Forward events
- Handle interruptions
- Handle cancellations

The Agent should never manage streams.

---

# 19. Structured Output

Whenever possible,

the Runtime should prefer structured outputs instead of free text.

Examples

- Planning
- Workflow Generation
- Tool Calls
- Skill Selection
- Validation

Structured JSON should always be preferred.

---

# 20. Tool Calling

Tool Calling is provided by the provider SDK.

The Runtime is responsible for

- Registering Tools
- Validating Tool Calls
- Executing Tools
- Returning Results

The provider only requests Tool Calls.

The Runtime performs execution.

---

# 21. Retry Strategy

The Runtime should retry

- Temporary Provider Errors
- Network Errors
- Timeout Errors

The Runtime should NOT retry

- Invalid Requests
- Authentication Errors
- Validation Errors
- Permission Errors

---

# 22. Timeout Strategy

Every execution should have a configurable timeout.

If execution exceeds the timeout,

the Runtime should

- Cancel execution
- Release resources
- Return a structured error

---

# 23. Cost Tracking

The Runtime tracks

- Prompt Tokens
- Completion Tokens
- Total Tokens
- Reasoning Tokens
- Execution Duration
- Estimated Cost
- Organization Usage

This data is used for analytics and billing.

---

# 24. Observability

Every AI execution should produce

Execution ID

Provider

Model

Execution Mode

Duration

Token Usage

Cost

Retries

Errors

These metrics help monitor system health.

---

# 25. Security

The Runtime must never expose

API Keys

Provider Credentials

Internal SDK Objects

Raw Provider Configuration

The Runtime is responsible for protecting provider access.

---

# 26. Future Smart Routing

Future versions may support intelligent model routing.

Example

Need Vision

↓

Gemini

Need Heavy Reasoning

↓

GPT-5

Need Fast Response

↓

Gemini Flash

Need Coding

↓

Claude

The Agent should continue using only

Low

Medium

High

without knowing which model executes the task.

---

# 27. Future Features

The following capabilities are intentionally excluded from the MVP

- Automatic Model Benchmarking
- Dynamic Cost Optimization
- Multi-Model Consensus
- Parallel Model Execution
- AI Self-Evaluation
- Adaptive Model Learning
- Regional Provider Selection

These may be added later without changing the Agent architecture.

---

# 28. Design Rules

1. The Agent must never know which provider is being used.
2. The Agent must never know which model is being used.
3. Every AI request passes through the LLM Runtime.
4. The Runtime is responsible for provider abstraction.
5. The Runtime is responsible for model abstraction.
6. Execution Modes represent quality levels, not model names.
7. Models may change without affecting existing Agents.
8. Providers may change without affecting existing Agents.
9. Provider failures should trigger automatic failover whenever possible.
10. Structured outputs should be preferred over free-text responses.
11. Tool execution belongs to the Runtime, not the provider.
12. The Runtime should remain provider-agnostic.
13. The Runtime should collect execution metrics for monitoring and billing.
14. API keys and provider credentials must never be exposed outside the Runtime.
15. The Runtime is the only layer allowed to communicate with AI providers.