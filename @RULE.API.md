---
tags:
  - woops
  - api
  - rest
aliases:
  - API Standards
  - API Rules
  - Endpoint Rules
---

# WOOPS Platform — API Standards
> REST API Design, Response Format & Endpoint Rules
>
> Version: 1.0
> Scope: Woops Platform Backend (Control Plane)
>
> This document defines the official API standards for the Woops Platform.
>
> Every endpoint must follow these rules.
>
> **These rules apply ONLY to the Woops Platform Backend.**
>
> **Do NOT apply these rules to the Workflow Runtime (n8n).**

---

# Current Scope

The AI Coding Agent is currently implementing only the **Woops Platform Backend**.

These rules apply to:

- Public APIs
- Internal APIs
- Dashboard APIs
- Runtime Client APIs

These rules do **NOT** apply to:

- n8n REST APIs
- n8n Internal APIs
- Frontend API Clients

---

# API Style

The platform follows a RESTful API architecture.

Every endpoint must be:

- Stateless
- Predictable
- Versioned
- Resource-Oriented
- Consistent

---

# API Versioning

All endpoints must be versioned.

Example

```
/api/v1/...
```

Future versions

```
/api/v2/...
```

Never expose unversioned APIs.

---

# Resource Naming

Use plural resource names.

Good

```
/users

/organizations

/agents

/conversations

/messages

/integrations
```

Bad

```
/user

/getUsers

/createAgent
```

---

# HTTP Methods

GET

Retrieve resources.

POST

Create resources.

PATCH

Update resources.

DELETE

Soft delete resources.

PUT should be avoided unless replacing an entire resource.

---

# URL Design

Good

```
GET /api/v1/agents

GET /api/v1/agents/{id}

POST /api/v1/agents

PATCH /api/v1/agents/{id}

DELETE /api/v1/agents/{id}
```

Bad

```
/getAgent

/createAgent

/deleteAgent
```

---

# Nested Resources

Use nesting only when ownership is explicit.

Good

```
GET /organizations/{id}/members

GET /agents/{id}/versions
```

Avoid deeply nested URLs.

Maximum nesting depth:

```
2
```

---

# Request Body

Request bodies must use DTOs.

Validation is mandatory.

Never accept unknown fields.

---

# Query Parameters

Use query parameters for:

- Pagination
- Filtering
- Searching
- Sorting

Example

```
GET /agents?status=active&limit=20
```

---

# Pagination

Every list endpoint must support pagination.

Preferred

Cursor Pagination

Parameters

```
cursor

limit
```

Optional

```
page

pageSize
```

---

# Filtering

Use query parameters.

Example

```
GET /agents?status=published
```

Never create separate endpoints for filters.

---

# Sorting

Example

```
GET /agents?sort=createdAt&order=desc
```

Allowed values

```
asc

desc
```

---

# Search

Example

```
GET /agents?search=sales
```

Never overload search into path parameters.

---

# Success Response

Every successful response must follow the same structure.

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

---

# Error Response

Every error response must follow the same structure.

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Agent not found."
  }
}
```

Never expose stack traces.

---

# Validation Errors

Validation errors must include field-level information.

Example

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed.",
    "fields": {
      "email": [
        "Invalid email address."
      ]
    }
  }
}
```

---

# HTTP Status Codes

Use standard status codes.

```
200 OK

201 Created

204 No Content

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

422 Unprocessable Entity

429 Too Many Requests

500 Internal Server Error
```

Avoid inventing custom status codes.

---

# Authentication

Protected endpoints require JWT authentication.

Example

```
Authorization

Bearer <access-token>
```

Never accept tokens through query parameters.

---

# Authorization

Authentication verifies identity.

Authorization verifies permission.

Every protected endpoint must perform both.

---

# Organization Context

Requests may execute in one of two contexts:

```
Individual User
```

or

```
Organization
```

Authorization must always evaluate the active context.

Never trust organization IDs supplied by the client without verifying membership.

---

# Idempotency

The following operations should be idempotent when appropriate:

- Retryable creates
- Billing webhooks
- Runtime deployment callbacks

Use idempotency keys where necessary.

---

# Request IDs

Every request must include a generated Request ID.

The server should return it in the response headers.

Example

```
X-Request-Id
```

---

# Correlation IDs

Internal service communication must propagate a Correlation ID.

This enables distributed tracing.

---

# Runtime Communication

The Platform communicates with the Runtime through internal REST APIs.

The Runtime is treated as an external service.

Never expose Runtime internal endpoints to public clients.

---

# DTO Rules

Every endpoint must have explicit DTOs.

Separate:

- Create DTO
- Update DTO
- Response DTO

Never reuse database entities as API responses.

---

# Response Mapping

Always map entities to DTOs.

Never return Prisma models directly.

---

# Error Codes

Every business error must have a stable error code.

Examples

```
USER_NOT_FOUND

EMAIL_ALREADY_EXISTS

INVALID_API_KEY

ORGANIZATION_NOT_FOUND

AGENT_NOT_FOUND

INSUFFICIENT_PERMISSIONS
```

Error codes should remain stable across API versions.

---

# API Documentation

Every endpoint should include:

- Summary
- Description
- Request DTO
- Response DTO
- Authentication requirements
- Possible error responses

Swagger/OpenAPI should be generated automatically from the codebase.

---

# Rate Limiting

Public APIs must support rate limiting.

Examples

- Authentication
- Registration
- Password Reset
- Public Agent APIs

Rate limits should be configurable.

---

# File Uploads

File uploads must use multipart/form-data.

Uploaded files should never be stored locally.

They must be sent to the configured storage provider.

---

# Webhooks

Webhook endpoints must:

- Verify signatures
- Be idempotent
- Return quickly
- Process work asynchronously

---

# Internal APIs

Internal APIs are only for trusted platform services.

They must authenticate using service credentials or signed tokens.

They must never be exposed publicly.

---

# Deprecation

Deprecated endpoints should:

- Remain versioned
- Return deprecation headers
- Be documented before removal

Never introduce breaking changes within the same API version.

---

# Performance

Avoid:

- Over-fetching
- Under-fetching
- Large payloads
- Expensive synchronous operations

Use pagination and selective field retrieval where appropriate.

---

# Security

Never expose:

- Internal IDs beyond intended resource identifiers
- Secrets
- Password hashes
- Tokens
- Internal exception details

Always validate and sanitize incoming data.

---

# API Principles

Every API should be:

- Predictable
- Consistent
- Backward Compatible
- Secure
- Versioned
- Well Documented
- Easy to Consume

---

---
### Obsidian Links
- **Mother:** [[@RULE.BUSINESS_MODEL.md]] — Full business model
- **Siblings:** [[@RULE.USERS.md#Authorization]] | [[@RULE.ARCHITECTURE.md#API Design]]

---

# Final Rule

The Woops Platform API is the public contract between the backend and its clients.

Every endpoint must provide a stable, secure, and consistent interface while remaining completely independent from the Workflow Runtime implementation. Business APIs belong exclusively to the Platform, while workflow execution remains the responsibility of the external Runtime service.