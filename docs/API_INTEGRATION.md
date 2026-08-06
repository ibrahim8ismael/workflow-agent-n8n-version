# Woops Agent Engine — Frontend API Integration Guide

> Consumer-facing reference for building against `woops-agent-engine`.
> Generated from the live controllers; the source of truth is Swagger at `GET /api/docs`.

---

## 1. Basics

- **Base URL**: `http://localhost:3000/api/v1` (dev) — all routes below are relative to this prefix.
- **Swagger UI**: `GET /api/docs` (JSON at `/api/docs-json`) — can be used to generate a typed client.
- **CORS**: enabled with credentials. Default allowed origin is `http://localhost:5173`, overridable via `CORS_ORIGIN` (comma-separated). In production only the configured origins are allowed.
- **Rate limiting**: 100 requests / 15 min per IP (global, express-rate-limit). OTP endpoints have stricter per-email/per-IP limits.
- **Content-Type**: `application/json` everywhere.

### Error envelope

Non-2xx responses use the Nest default shape (set by `GlobalExceptionFilter`):

```json
{ "statusCode": 400, "message": "Validation error", "timestamp": "2026-08-02T00:00:00.000Z" }
```

- `message` is human-readable; validation failures report `"Validation error"`.
- Zod `ValidationError`/Prisma errors map to 400; unknown errors to 500.

### Pagination

List endpoints accept `?page=1&limit=20` (limit default 20) and return:

```json
{
  "data": [],
  "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 0 }
}
```

---

## 2. Authentication (passwordless OTP)

No passwords, no separate signup. Registration and login are the same flow: if the email is new, a user is created.

### 2.1 Request an OTP

```
POST /auth/otp/request
{ "email": "user@example.com" }
```

- Rate limited per email (5/hour) and per IP (20/hour).
- Returns `{ "success": true, "message": "OTP sent to email" }`.

### 2.2 Verify the OTP

```
POST /auth/otp/verify
{ "email": "user@example.com", "otp": "123456" }
```

- OTP: 6 digits, valid 5 minutes, max 5 attempts.
- On success the server sets the refresh token in an **HttpOnly cookie** (`woops_refresh`, path `/api/v1/auth`, SameSite=Lax, Secure in prod) and returns:

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "sessionId": "ses_...",
    "user": { "id": "user_...", "email": "user@example.com", "name": null, "role": "USER" }
  }
}
```

**Frontend rules** (from `docs/auth.doc.md`):

- Store the access token in **memory only** — never LocalStorage/SessionStorage.
- Send it as `Authorization: Bearer <accessToken>`.
- The refresh token lives in the HttpOnly cookie and is never readable by JS — send it with `credentials: "include"` (`withCredentials: true` in axios/fetch).

### 2.3 Refresh

```
POST /auth/refresh      (cookie: woops_refresh, credentials: include)
```

- Rotates the refresh token (old one invalidated) and returns a new access token.
- Return 401 with `{ code: "NO_REFRESH_TOKEN", message: "Refresh token not found" }` if the cookie is absent — trigger a full login.

### 2.4 Logout

```
POST /auth/logout        (auth required) → 204
POST /auth/logout-all    (auth required) → 204
```

Both revoke the session(s) and clear the cookie.

### 2.5 Switch organization

```
POST /auth/switch-organization   (auth required)
{ "organizationId": "org_..." }
```

Issues a new access token for the selected active context. No re-login needed.

### Token payload

`userId`, `sessionId`, `activeContext` (`individual` | `organization`), `organizationId` (optional), `role`, `tokenVersion`.

---

## 3. Core domain endpoints

### Runs (agent execution)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/runs` | optional | Execute an agent. Returns 202 with `{ runId, response, usage }` (see below) |
| `POST` | `/runs/:id/confirm` | optional | Confirm a ready employee design and create a `DRAFT` agent |
| `GET` | `/runs/:id` | optional | Poll run status/result (`Run` entity: status, result, token usage) |

```json
// POST /runs
{ "userMessage": "Summarize Q2 revenue", "agentId": "agent_...", "conversationId": "conv_...?" }
```

`POST /runs` runs synchronously in the request; if the run fails, the response body still returns with the error message and the run is marked `FAILED`. Poll `GET /runs/:id` for the persisted state.

Employee design runs are review-only. They return a blueprint with `description`,
`instructions`, and a readiness state. Call `/runs/:id/confirm` only after the
business owner approves a blueprint. Confirmation creates the employee as
`DRAFT`; it does not publish or activate it.

### Agents

`GET/POST /agents`, `GET/PATCH/DELETE /agents/:id` — create/update agent (name, description, instructions, model), list, get skills via `GET /agents/:id/skills` (where available).

### Skills

`GET/POST /skills`, `GET/PATCH/DELETE /skills/:id` — capability definitions (name, slug, executionMode, instructions, timeout, retryPolicy, inputSchema).

Execution modes: `KNOWLEDGE_RETRIEVAL`, `MEMORY_RETRIEVAL`, `N8N_WORKFLOW`, `AI_ONLY`, `HYBRID`, `HUMAN_APPROVAL` (cannot run autonomously).

### Knowledge

`GET/POST /knowledge`, `GET/PATCH/DELETE /knowledge/:id`, `POST /knowledge/search` — documents/chunks for pgvector retrieval.

### Memory

`GET/POST /memory`, `GET/PATCH/DELETE /memory/:id` — persistent agent memory entries.

### Conversations

`GET/POST /conversations`, `GET/PATCH/DELETE /conversations/:id`, `GET /conversations/:id/messages` — chat history. A run without a `conversationId` creates a `New chat` conversation automatically and returns its `conversationId`. Use that ID in `/new/:conversationId` and send it with every later run.

### Channels / Integrations / Notifications

- `GET/POST /channels`, `GET/PATCH/DELETE /channels/:id`
- `GET/POST /integrations`, `GET/PATCH/DELETE /integrations/:id`
- `GET/POST /notifications`, `GET/PATCH/DELETE /notifications/:id`

### Organizations / Users

- `GET/POST /organizations`, `GET/PATCH/DELETE /organizations/:id`
- `GET/PATCH /users/me` — profile management, deactivation

---

## 4. Billing

| Method | Path | Notes |
| --- | --- | --- |
| `GET/POST` | `/billing` | billing overview / actions |
| `GET/POST` | `/subscriptions`, `POST /subscriptions/upgrade` | create/upgrade subscription |
| `GET/POST` | `/top-up` | credit top-up |
| `GET/POST` | `/coupons` | coupon redemption |
| `GET` | `/wallet` | wallet balance / transactions |
| `GET` | `/invoices` | invoice list |
| `GET` | `/usage` | metered usage |

## 5. Admin (system admins only)

`/admin/analytics`, `/admin/audit-logs`, `/admin/users`, `/admin/organizations`, `/admin/subscriptions`, `/admin/wallets`, `/admin/plans`, `/admin/coupons`, `/admin/feature-flags` — guarded by `SystemAdminGuard`.

## 6. Realtime

- **Namespace**: `/ws` (Socket.IO), CORS `*`.
- Currently only the server socket is wired (`RealtimeGateway`); run lifecycle events (run started/updated/completed/failed) are intended to be pushed here — subscribe to run events keyed by `runId`/`organizationId`. Verify actual emitted events against the gateway before relying on them.

## 7. Health

`GET /health` — Redis + Prisma liveness. Returns 503 when Redis is down; the app still boots without infra.

---

## 8. Suggested frontend auth bootstrap

```ts
const API = "/api/v1";

// 1. request OTP
await fetch(`${API}/auth/otp/request`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
});

// 2. verify → keep access token in memory, cookie handled by browser
const res = await fetch(`${API}/auth/otp/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({ email, otp }),
});
const { accessToken, user } = (await res.json()).data;

// 3. authenticated request
fetch(`${API}/runs/${runId}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
  credentials: "include",
});

// 4. silent refresh when 401 (cookie is included automatically)
const refreshed = await fetch(`${API}/auth/refresh`, {
  method: "POST",
  credentials: "include",
});
```

### Auth guard checklist

1. Access token in memory; attach `Authorization: Bearer`.
2. All requests `credentials: "include"` so the refresh cookie is sent.
3. On 401 from `/auth/refresh` → wipe state, redirect to login.
4. Intercept 401s, refresh once, retry the original request, then force-login on second failure.
