# WOOPS Platform — Authentication System
> Passwordless Authentication Architecture
>
> Version: 1.0
> Scope: Woops Platform Backend (Control Plane)
>
> This document defines the authentication architecture for the Woops Platform.
>
> Authentication is completely independent from the Workflow Runtime.
>
> The Runtime never authenticates users.

---

# Current Scope

The AI Coding Agent is currently implementing only the **Woops Platform Backend**.

Authentication belongs exclusively to this repository.

Do NOT implement authentication inside:

- n8n Runtime
- Frontend
- AI Runtime

---

# Authentication Philosophy

Woops is a **Passwordless Platform**.

Users never create passwords.

Authentication is performed using one-time verification codes (OTP).

This reduces:

- Password reuse
- Credential leaks
- Password reset complexity
- Phishing attacks

---

# Supported Authentication Methods

Current

- Email OTP

Future

- Google OAuth
- Microsoft OAuth
- GitHub OAuth
- Apple Sign In
- Enterprise SSO (OIDC/SAML)
- Passkeys (WebAuthn)

The authentication architecture must support adding these providers without redesigning the system.

---

# Authentication Flow

```
Email

↓

Request OTP

↓

Verify OTP

↓

Issue Tokens

↓

Authenticated
```

---

# Registration

Registration and Login use the same flow.

There is no separate signup endpoint.

If the email does not exist

↓

Create User

Else

↓

Login User

---

# OTP

OTP is the identity verification mechanism.

Requirements

- Numeric
- 6 digits
- Cryptographically secure random
- Single use
- Short lifetime

Recommended expiration

```
5 minutes
```

Maximum attempts

```
5
```

---

# OTP Storage

OTP must never be stored in PostgreSQL.

Store OTP inside Redis.

Key

```
otp:<email>
```

Store

- Hashed OTP
- Expiration
- Attempt Counter

Never store OTP in plain text.

---

# Rate Limiting

OTP generation must be rate limited.

Examples

Per email

```
5 requests / hour
```

Per IP

```
20 requests / hour
```

Verification attempts

```
5 attempts
```

After exceeding limits

↓

Temporary lockout

---

# Email Verification

Email verification is built into authentication.

A successfully verified OTP means:

- Email verified
- User authenticated

No separate email verification flow is required.

---

# JWT Strategy

Two-token architecture.

```
Access Token

+

Refresh Token
```

---

# Access Token

Purpose

Authorize API requests.

Storage

Memory only (frontend).

Never store in LocalStorage or SessionStorage.

Lifetime

Recommended

```
15 minutes
```

Contains

- userId
- activeContext
- organizationId (optional)
- role
- tokenVersion
- sessionId

---

# Refresh Token

Purpose

Issue new Access Tokens.

Storage

HttpOnly Cookie only.

Never expose Refresh Tokens to JavaScript.

Recommended lifetime

```
30 days
```

---

# Cookie Settings

Refresh Token cookie must always use:

```
HttpOnly = true

Secure = true

SameSite = Lax
```

Production should always require HTTPS.

Never disable HttpOnly.

---

# Refresh Token Rotation

Every refresh request must generate

- New Access Token
- New Refresh Token

Old Refresh Token becomes invalid immediately.

This prevents replay attacks.

---

# Refresh Token Family

Every login creates a token family.

If a reused refresh token is detected

↓

Invalidate the entire family.

↓

Require a new login.

---

# Sessions

Every successful login creates a session.

A session contains

- Session ID
- User ID
- Device
- Browser
- IP
- Created At
- Last Used At
- Expires At

Users should be able to revoke sessions.

---

# Multiple Devices

Users may stay logged in on multiple devices simultaneously.

Each device owns a different refresh token.

---

# Logout

Logout must:

- Delete Refresh Token cookie
- Revoke session
- Revoke refresh token

Access Token expires naturally.

---

# Logout All Devices

Invalidate

All refresh tokens

All sessions

Increment tokenVersion if required.

---

# Token Version

Every user has

```
tokenVersion
```

When incremented

↓

All existing access tokens become invalid after refresh validation.

Useful for

- Account compromise
- Logout everywhere
- Admin force logout

---

# Authentication Middleware

Every protected request must:

1. Validate JWT
2. Validate signature
3. Validate expiration
4. Validate tokenVersion
5. Resolve active context
6. Load identity

---

# Authorization

Authentication only identifies the user.

Permissions are evaluated separately.

Authentication must never contain business authorization logic.

---

# Active Context

A user authenticates once.

After authentication

↓

The active context becomes either

- Individual
- Organization

The frontend may switch context without requiring a new login.

---

# Organization Switching

Switching organizations does not create a new session.

The backend issues a new Access Token containing the selected context.

The Refresh Token remains unchanged.

---

# API Keys

API Keys are not authentication sessions.

They authenticate machine-to-machine requests only.

API Keys never receive Refresh Tokens.

---

# Runtime Authentication

The Runtime never authenticates users.

The Platform authenticates users.

The Platform authenticates to the Runtime using service credentials.

---

# Security Rules

Never store

- Passwords
- Plain OTPs
- Plain Refresh Tokens

Hash:

- OTP
- Refresh Tokens
- API Keys

Encrypt sensitive provider credentials when persisted.

---

# Audit Logging

Authentication events must be logged.

Examples

- OTP Requested
- OTP Verified
- Login
- Logout
- Refresh
- Session Revoked
- Organization Switched
- Failed Verification

Audit logs must include:

- User ID (if known)
- IP Address
- User Agent
- Timestamp
- Request ID

---

# Future Compatibility

The authentication system must support:

- OAuth Providers
- Passkeys (WebAuthn)
- Enterprise SSO
- MFA
- Trusted Devices
- Device Approval
- Magic Links

without redesigning the architecture.

---

# Authentication Principles

- Passwordless by default.
- OTP is the primary authentication mechanism.
- Email verification is part of login.
- Refresh Tokens live only in HttpOnly cookies.
- Access Tokens are short-lived.
- Refresh Tokens are rotated.
- Sessions are device-based.
- Authentication and Authorization are separate concerns.
- The Workflow Runtime never authenticates users.

---

# Final Rule

The Woops Platform uses a modern passwordless authentication architecture based on OTP verification, short-lived JWT access tokens, rotating refresh tokens stored in secure HttpOnly cookies, and device-based sessions. Authentication is fully owned by the Platform Backend and remains completely isolated from the Workflow Runtime.