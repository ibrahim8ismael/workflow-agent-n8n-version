# Woops Agent Engine

Backend for the Woops AI Agent Platform — a modular NestJS monolith where each **Agent** is an AI employee with **Skills** (capabilities), executed through a plan-driven runtime with knowledge retrieval, memory, and n8n-powered integrations.

## Stack

- **Runtime**: NestJS 11 (TypeScript, SWC, `@nestjs/swagger` at `/api/docs`)
- **Database**: PostgreSQL 16 + pgvector (`pgvector/pgvector:pg16`) via Prisma 7
- **AI**: Vercel AI SDK 7 (OpenAI / Anthropic / Google / Groq), `gpt-4o` default
- **Queue/Cache**: BullMQ + Redis 7
- **Storage**: MinIO (S3-compatible)
- **Observability**: Sentry + pino logs; health endpoint `GET /api/v1/health`
- **Quality**: Biome (lint/format), Vitest (unit + e2e), Lefthook pre-commit hooks, GitHub Actions CI

## Architecture

```
POST /api/v1/runs (userMessage, agentId) → Run created → PREPARING → PLANNING
  → Planner (AI structured output) → validate plan
  → EXECUTING → AI SDK tool loop over plan steps
     → skills dispatch by execution mode:
        KNOWLEDGE_RETRIEVAL  → reserved for the post-MVP KB phase
        MEMORY_RETRIEVAL     → agent memory search
        N8N_WORKFLOW         → POST ${N8N_WEBHOOK_URL}/${skill.slug} (retries)
        AI_ONLY / HYBRID     → nested AI call with skill instructions (± retrieved context)
        HUMAN_APPROVAL       → guarded (cannot run autonomously)
  → persist conversation + memory → COMPLETED / FAILED
```

Rules of the domain live in the Obsidian vault (`woops/rules/`): Agent = AI Employee, Skill = capability, Run = execution, Plan = decision, and **n8n owns all OAuth/integrations/channels** — the engine only calls webhooks.

## Quickstart (local)

```bash
cp .env.example .env          # fill in DATABASE_URL, REDIS_URL, OPENAI_API_KEY, etc.
npm install
npm run prisma:generate
npm run prisma:migrate        # local dev migration (needs Postgres with pgvector)
npm run dev                   # http://localhost:3000/api/v1, docs at /api/docs
```

### Verify it boots without infra

`npm run build && node dist/main.js` — the app degrades gracefully when Redis is down (`/api/v1/health` returns 503), so you can verify boot, Swagger, and routing with zero infrastructure.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | watch mode |
| `npm run build` | SWC compile to `dist/` |
| `npm run typecheck` | `tsc --noEmit` (heap raised to 4 GB for AI SDK types) |
| `npm run lint:ci` / `lint` | Biome ci / autofix |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | e2e tests against a mocked DB/Redis/AI stack |
| `npm run prisma:deploy` | apply migrations (prod/CI) |
| `npm run prisma:seed` | seed script (`prisma/seed.ts`, tsx) |
| `npm run prisma:studio` | Prisma Studio |

## Deployment

Docker-based VPS deployment — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Key artifacts:

- `Dockerfile` — multi-stage, non-root user, `prisma generate`, HEALTHCHECK
- `docker-compose.yml` — postgres (pgvector), redis, minio, `migrate` job, `app`
- `.github/workflows/ci.yml` — pgvector + redis services, migrate deploy, lint, typecheck, tests, docker build
- `prisma/migrations/` — baseline migration with `CREATE EXTENSION IF NOT EXISTS vector;`

## Configuration

Environment is validated at boot via zod (`src/config/schema.ts`) — the app refuses to start with invalid values (e.g. short `JWT_SECRET`). Key vars:

- `DATABASE_URL`, `REDIS_URL`, `MINIO_*` / `STORAGE_*`
- `OPENAI_API_KEY` (and friends for Anthropic/Google/Groq), `AI_PROVIDER`, model strings like `openai:gpt-4o`
- `JWT_SECRET` (>= 32 chars), `N8N_WEBHOOK_URL` (base URL for N8N_WORKFLOW skills)
- `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_RELEASE`
- `NOTIFICATION_PROVIDER` / `EMAIL_PROVIDER` (SMTP, Twilio)

## API surface

- `POST /api/v1/runs` — execute an agent run (202; poll the run via GET)
- `GET /api/v1/runs/:id` — run status / result / token usage
- `GET /api/v1/health` — Redis + Prisma liveness
- Agents, skills, knowledge, memory, conversations, users, auth, billing, admin — Swagger at `/api/docs`

### Markdown knowledge bases

Knowledge documents are Markdown-only. Upload a `.md` file through `POST /api/v1/knowledge/upload` as multipart form-data using the `file` field. Optional fields include `title`, `organizationId`, and `category`.

The upload limit is 5 MB. The original filename is stored as the document source, and the file is chunked automatically for knowledge retrieval. Raw ingestion is also available through `POST /api/v1/knowledge/ingest`, but it requires `contentType: "markdown"`.
