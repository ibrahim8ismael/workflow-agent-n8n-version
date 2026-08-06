# Woops Knowledge Base (KB) Domain Specification

> Version: 1.0.0
> Status: Draft
> Owner: Woops Architecture Team

> Implementation reference: [[@RULE.AGENT.KB.ARCHITECTURE]]
> API reference: [[docs/knowledge-base]]

---

# 1. Overview

The Knowledge Base (KB) is the trusted business intelligence layer for an AI Agent.

Its purpose is to teach the Agent how the organization works.

Unlike Memory, which stores learned information over time, the Knowledge Base stores approved and verified business information.

Every Agent relies on the Knowledge Base to understand the organization before making decisions or executing Skills.

The Knowledge Base is considered the **Single Source of Truth** for every business-specific fact.

---

# 2. Purpose

The Knowledge Base exists to answer one question:

> "How does this business operate?"

The Agent should never assume the answer.

Instead, it should retrieve the answer from the organization's Knowledge Base.

---

# 3. Philosophy

Every organization is different.

Even if two companies work in the same industry,

they may have different

- products
- pricing
- policies
- workflows
- terminology
- customer journey
- approval process

Therefore,

the Agent must adapt its behavior according to the organization's Knowledge Base instead of relying on general AI knowledge.

---

# 4. Responsibilities

The Knowledge Base is responsible for

- Business Model
- Company Information
- Products
- Services
- Pricing
- Business Policies
- Internal Procedures (SOPs)
- FAQs
- Documentation
- Business Rules

The Knowledge Base is NOT responsible for

- Conversation History
- User Preferences
- Agent Experience
- Temporary Context
- AI Reasoning

---

# 5. Knowledge First Principle

The Agent must never guess business information.

Before executing any business Skill,

the Agent should consult the Knowledge Base whenever business-specific information is required.

If the requested information does not exist,

the Agent should ask the user for clarification.

Business assumptions are prohibited.

---

# 6. Single Source of Truth

The Knowledge Base is the official source of business information.

If multiple sources provide conflicting information,

the Knowledge Base always wins.

Priority

Knowledge Base

↓

Memory

↓

Conversation

↓

LLM General Knowledge

The Agent should never override the Knowledge Base.

---

# 7. Knowledge Ownership

Every Knowledge Base belongs to

Organization

↓

Agent

An Agent can only access the Knowledge Base assigned to it.

Different Agents may have different Knowledge Bases.

Example

Sales Agent

↓

Sales Documents

Support Agent

↓

Support Documentation

HR Agent

↓

HR Policies

---

# 8. Business Model

Every Knowledge Base should begin with the organization's Business Model.

The Business Model defines

- Business Type
- Industry
- Mission
- Services
- Products
- Revenue Model
- Customer Journey
- Sales Process
- Support Process
- Company Goals

Without understanding the Business Model,

the Agent cannot execute business Skills correctly.

---

# 9. Structured Knowledge

Structured Knowledge contains organized business information.

Examples

Company Profile

Products

Services

Pricing

Working Hours

Locations

Departments

Policies

FAQs

Glossary

Business Rules

Structured Knowledge is easy to query and should always be preferred.

---

# 10. Unstructured Knowledge

Unstructured Knowledge contains documents.

Examples

PDF

Word

Excel

PowerPoint

Website

Help Center

Notion

Confluence

Markdown

Text Files

Emails

These documents are processed and indexed before becoming searchable.

---

# 11. Knowledge Sources

Knowledge may originate from

Manual Input

Website

Uploaded Documents

API

CMS

Help Center

Notion

Google Drive

Future integrations

Every piece of Knowledge should know its source.

---

# 12. Approved Knowledge

Only verified information should become part of the Knowledge Base.

Unverified information should never be treated as business truth.

Every organization decides what information is approved.

---

# 13. Knowledge Categories

Recommended categories

Company

Business Model

Products

Services

Pricing

Policies

FAQs

Processes

Documentation

Compliance

Legal

Training

Custom

Categories help retrieval but do not change the data itself.

---

# 14. Knowledge Retrieval

The Agent retrieves Knowledge only when needed.

Typical flow

Receive Request

↓

Determine Required Knowledge

↓

Search KB

↓

Retrieve Relevant Information

↓

Inject into Context

↓

Continue Execution

The Agent should never load the entire Knowledge Base.

Only relevant information should be retrieved.

---

# 15. Knowledge Search

The Knowledge service should support

Semantic Search

+

Metadata Filters

Example

Search

Category = Pricing

Language = Arabic

Product = Premium

Return

Relevant Pricing Information

---

# 16. Knowledge Context

Knowledge becomes part of the execution context.

Execution Context

System Instructions

↓

Business Knowledge

↓

Memory

↓

Conversation

↓

Current User Request

↓

LLM

Knowledge should always appear before Memory because business rules are more important than learned facts.

---

# 17. Knowledge and Skills

Skills should never contain business logic.

Instead,

Skills should request business information from the Knowledge Base.

Example

Refund Skill

↓

Retrieve Refund Policy

↓

Execute

Example

Leave Approval Skill

↓

Retrieve Leave Policy

↓

Execute

Example

Sales Skill

↓

Retrieve Pricing

↓

Execute

The same Skill can therefore work for thousands of organizations.

---

# 18. Knowledge and Memory

Knowledge

Stores verified business information.

Memory

Stores learned information.

Example

Knowledge

Refund period is 30 days.

Memory

Customer prefers communication by email.

Never mix them.

---

# 19. Knowledge and Conversation

Conversation stores messages.

Knowledge stores business intelligence.

Conversation

"What is your refund policy?"

Knowledge

"Our refund policy is 30 days."

Conversation is temporary.

Knowledge is persistent.

---

# 20. Knowledge Updates

Knowledge may be updated when

Business changes

Pricing changes

Policies change

Products change

Services change

Documentation changes

Every update should replace outdated information.

The Agent should always retrieve the latest approved version.

---

# 21. Knowledge Validation

Before information enters the Knowledge Base,

it should be reviewed or approved.

The Agent should not create business knowledge automatically.

Knowledge should always be intentional.

---

# 22. Knowledge Security

Knowledge belongs to the Organization.

Organizations cannot access each other's Knowledge.

Permissions may restrict

Categories

Documents

Departments

Agents

Future versions may support role-based access.

---

# 23. Knowledge Events

KnowledgeCreated

KnowledgeUpdated

KnowledgeDeleted

KnowledgeIndexed

KnowledgeRetrieved

KnowledgeApproved

KnowledgeReindexed

---

# 24. Knowledge Processing Pipeline

For uploaded documents

Upload

↓

Extract Text

↓

Chunk Content

↓

Generate Embeddings

↓

Store Metadata

↓

Index

↓

Ready for Retrieval

The Agent never interacts directly with this pipeline.

It only queries the Knowledge service.

---

# 25. Agent Rules

The Agent should

✓ Trust the Knowledge Base.

✓ Retrieve Knowledge before executing business Skills.

✓ Adapt behavior according to business information.

✓ Ask for clarification when Knowledge is missing.

The Agent must never

✗ Invent products.

✗ Invent prices.

✗ Invent policies.

✗ Invent services.

✗ Invent workflows.

✗ Invent business rules.

---

# 26. Skill Rules

A Skill may

Read Knowledge

Search Knowledge

Reference Knowledge

A Skill must never

Modify Knowledge

Delete Knowledge

Approve Knowledge

Knowledge management belongs to administrators.

---

# 27. Design Principles

1. The Knowledge Base is the Single Source of Truth.
2. Every organization owns its own Knowledge Base.
3. The Agent must never assume business information.
4. Business logic belongs in the Knowledge Base, not inside Skills.
5. Only relevant Knowledge should be retrieved.
6. Structured Knowledge should be preferred over documents whenever possible.
7. Documents are a source of Knowledge, not the Knowledge itself.
8. Knowledge is persistent.
9. Knowledge is organization-specific.
10. Memory never replaces Knowledge.
11. Conversation never replaces Knowledge.
12. The Knowledge Base should teach the Agent how the business operates.
13. The Agent should adapt its behavior according to the organization's Knowledge Base.
14. Approved Knowledge always has priority over AI assumptions.
15. A well-maintained Knowledge Base produces reliable AI Employees.

---

# 28. Current Backend Implementation

The current Woops backend implements the Knowledge Base as a Markdown-only document system.

- Upload: `POST /api/v1/knowledge/upload` accepts `.md` files through multipart form-data.
- Direct ingestion: `POST /api/v1/knowledge/ingest` accepts Markdown text with `contentType: markdown`.
- Edit: `PATCH /api/v1/knowledge/:id` replaces the full Markdown document when `content` is provided and reindexes its chunks.
- Delete: `DELETE /api/v1/knowledge/:id` soft-deletes the document and its chunks.
- Limit: all ingestion and edit paths enforce a 5 MB UTF-8 byte limit.
- Chunking: content is split into 1,000-character chunks with 200-character overlap.
- Retrieval: current search is organization-scoped, case-insensitive text containment.

The implementation stores extracted Markdown text and chunk metadata in PostgreSQL. It does not currently store the uploaded binary file, generate embeddings, or provide approval workflows. See [[@RULE.AGENT.KB.ARCHITECTURE]] for the implemented architecture and current gaps.
