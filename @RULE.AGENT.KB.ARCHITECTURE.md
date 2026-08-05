---
tags:
  - woops
  - knowledge
  - kb
  - architecture
aliases:
  - Knowledge Base Architecture
  - KB Architecture
---

# Woops Knowledge Base Architecture

> Implementation status: Markdown-only document ingestion, chunking, retrieval, editing, and soft deletion.
> Last updated: 2026-08-05
> Related: [[@RULE.AGENT.KB]], [[docs/knowledge-base]]

## Boundary

The Knowledge Base is a Platform-owned business capability. It stores approved organization-specific information and supplies relevant chunks to the Runtime. The Runtime can retrieve knowledge but does not manage KB documents directly.

```text
Client / Admin UI
        |
        v
KnowledgeController
        |
        v
KnowledgeService
        |
        +--> Markdown validation and 5 MB UTF-8 limit
        +--> Chunking (1,000 chars, 200-char overlap)
        |
        v
KnowledgeRepository
        |
        v
PostgreSQL
  knowledge_documents
  knowledge_document_chunks
        ^
        |
Runtime / Context Builder / Knowledge Skills
```

## Ingestion Flow

```text
.md file upload
        |
        v
Multer checks .md extension and 5 MB transport limit
        |
        v
Read file buffer as UTF-8 Markdown
        |
        v
Validate content and metadata
        |
        v
Create KnowledgeDocument
        |
        v
Split Markdown into overlapping chunks
        |
        v
Create KnowledgeDocumentChunk rows
        |
        v
Available to organization-scoped search
```

The JSON ingestion endpoint follows the same service path after receiving Markdown text. The service repeats the byte-size validation so the limit cannot be bypassed by using JSON instead of multipart upload.

## Document Lifecycle

### Create

Documents are Markdown-only and may belong to an organization. Category data is stored in document metadata. Ingested documents are immediately chunked.

### Edit

`PATCH /api/v1/knowledge/:id` supports metadata changes and full content replacement. When content is supplied:

```text
Validate new Markdown
        |
        v
Update document row
        |
        v
Soft-delete current chunks
        |
        v
Create chunks from the replacement content
```

The edit contract is replacement-based. To add more business data, the caller sends the complete updated Markdown document. This prevents old chunks from remaining searchable after a content change.

### Delete

`DELETE /api/v1/knowledge/:id` is a soft delete. The document and its chunks receive `deletedAt`. Repository queries filter deleted documents and chunks from normal access.

## Retrieval Flow

```text
User request
        |
        v
Runtime resolves organization context
        |
        v
KnowledgeService.search(query, organizationId)
        |
        v
Case-insensitive chunk text search
        |
        v
Relevant chunks
        |
        v
Injected into agent context or returned by a KNOWLEDGE_RETRIEVAL skill
```

Knowledge retrieval is organization-scoped. Current search uses PostgreSQL text containment. The Prisma model reserves `embedding vector(1536)` for a future semantic retrieval implementation; the current ingestion path does not generate embeddings.

## Limits and Invariants

- Only `.md` files are accepted by the upload endpoint.
- `contentType` must be `markdown`.
- Maximum document content is 5 MB in UTF-8 bytes.
- Empty Markdown content is rejected for ingestion and edits.
- Chunks are always associated with one `KnowledgeDocument`.
- Deleted documents and chunks are excluded from normal retrieval.
- Agents and Skills retrieve knowledge; they do not modify or delete it.

## Current Gaps

- Authentication and organization authorization are not implemented in the KnowledgeController itself yet; production access must be protected consistently with the platform authorization model.
- Search is text-based rather than semantic vector search.
- Uploaded files are read into the database content field; the original binary file is not stored in MinIO.
- Approval and publishing workflows are specified by the KB domain rules but are not yet implemented in this module.
