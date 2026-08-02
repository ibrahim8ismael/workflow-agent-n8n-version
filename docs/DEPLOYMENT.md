# Deployment Runbook — Docker VPS

Production deployment of the Woops Agent Engine on a Docker-capable VPS (Ubuntu 22.04+ recommended).

## 1. Prerequisites

- VPS with Docker Engine + Docker Compose v2 (see docker docs: `curl -fsSL https://get.docker.com | sh`)
- DNS A record pointing at the VPS (for TLS via Caddy/nginx, optional)
- A Sentry project DSN (optional but recommended)
- LLM API keys (OpenAI at minimum — `gpt-4o` is the default model)

## 2. First deploy

```bash
# on the VPS
git clone git@github.com:ibrahim8ismael/woops-agent-engine.git /opt/woops
cd /opt/woops
cp .env.example .env
vim .env        # set DATABASE_URL, REDIS_URL, JWT_SECRET (>= 32 chars), OPENAI_API_KEY, ...
```

Minimum `.env` for a single-host deploy:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://woops:CHANGE_ME@postgres:5432/woops?schema=public
REDIS_URL=redis://redis:6379
JWT_SECRET=<48+ random bytes>
OPENAI_API_KEY=sk-...
SENTRY_DSN=
```

> The `DATABASE_URL` host must be `postgres` (the compose service name), not `localhost`.

Then:

```bash
docker compose up -d --build
```

Compose brings up `postgres` (pgvector image), `redis`, `minio`, runs the `migrate` job (`prisma migrate deploy`), and starts `app` with a healthcheck on `/api/v1/health`. The seed can be run once with:

```bash
docker compose run --rm app npm run prisma:seed
```

## 3. Verify

```bash
docker compose ps                     # all services healthy
curl -s http://localhost:3000/api/v1/health
curl -s http://localhost:3000/api/docs | head -5   # swagger
```

`/api/v1/health` returns `200 {"status":"ok"}` when Postgres and Redis are reachable. If Redis is down the app still boots and returns `503` there — check `docker compose logs app`.

### Smoke test the runtime

```bash
# create an agent + an AI_ONLY skill, attach it, then:
curl -s -X POST http://localhost:3000/api/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{"userMessage":"say hello","agentId":"<agent-id>"}'
# -> { "runId": "...", "response": "..." }
curl -s http://localhost:3000/api/v1/runs/<runId>   # status: COMPLETED
```

## 4. Updates / rollbacks

```bash
git pull origin main
docker compose up -d --build          # migrate job runs migrations automatically
docker compose logs -f migrate app
```

Roll back a bad release: `git checkout <previous-tag> && docker compose up -d --build`.

## 5. n8n integration

Set `N8N_WEBHOOK_URL=https://n8n.example.com/webhook` in `.env` and restart `app`. Skills with `executionMode = N8N_WORKFLOW` call `POST {N8N_WEBHOOK_URL}/{skill.slug}` with the skill args (+ `userId` / `organizationId`). 5xx responses are retried per the skill's `retryPolicy.maxAttempts` (default 1).

## 6. Observability

- **Sentry**: set `SENTRY_DSN`; the app initializes the SDK at boot and captures all 5xx exceptions with the request path. `SENTRY_RELEASE` can be set to the git SHA during deploys.
- **Logs**: pino JSON to stdout — `docker compose logs -f app | jq -r '.msg'` or pipe to a log collector.
- **Health**: wire the VPS uptime check / Load Balancer to `GET /api/v1/health`.

## 7. Backups

Postgres volume is `pgdata` (see `docker-compose.yml`). Nightly:

```bash
docker compose exec postgres pg_dump -U woops woops | gzip > /backups/woops-$(date +%F).sql.gz
```

Restore: `gunzip -c <backup> | docker compose exec -T postgres psql -U woops woops`.

## 8. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `app` exits at boot | invalid env — check `docker compose logs app`; `validateConfig` refuses bad `JWT_SECRET` etc. |
| `migrate` job fails | DB unreachable or `CREATE EXTENSION vector` missing — ensure the `pgvector/pgvector:pg16` image |
| health 503 | Redis/Postgres down — `docker compose restart redis postgres` |
| runs fail with `N8N_WEBHOOK_URL is not configured` | set `N8N_WEBHOOK_URL` for n8n-backed skills |
| out of memory during CI typecheck | `NODE_OPTIONS=--max-old-space-size=4096` is baked into the `typecheck` script |
