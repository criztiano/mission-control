# Vercel Deployment Guide

Eden deploys to Vercel with Neon Postgres as the database.

## Two Environments

| Environment | Branch | Neon Branch | URL |
|-------------|--------|-------------|-----|
| **Production** | `main` | `main` | `eden.yourdomain.com` |
| **Preview/Dev** | `develop` | `dev` (Neon branch) | Vercel preview URL |

Neon branching means dev gets its own isolated database — safe to test migrations and data changes before pushing to main.

---

## Setup Steps

### 1. Create Neon Database

1. Sign up at [neon.tech](https://neon.tech) (free tier works)
2. Create a new project
3. Note the **main branch** connection string
4. Create a **dev branch** in the Neon console → note that connection string too

### 2. Run Drizzle Migrations

Before first deploy, apply the schema to both Neon branches:

```bash
# Production (main branch)
DATABASE_URL=<main-neon-url> npx drizzle-kit migrate

# Dev branch
DATABASE_URL=<dev-neon-url> npx drizzle-kit migrate
```

### 3. Migrate Existing Data (optional)

If you have data in SQLite to migrate:

```bash
# Migrate to production DB
DATABASE_URL=<main-neon-url> npx tsx scripts/migrate-sqlite-to-postgres.ts

# Migrate to dev DB
DATABASE_URL=<dev-neon-url> npx tsx scripts/migrate-sqlite-to-postgres.ts
```

The script is idempotent — safe to re-run.

### 4. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) → Import project
2. Connect GitHub repo (`criztiano/mission-control`)
3. Framework: **Next.js** (auto-detected)

### 5. Configure Environment Variables

In Vercel project settings → **Environment Variables**:

#### Production (`main` branch)

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon main branch connection string |
| `AUTH_USER` | Admin username |
| `AUTH_PASS` | Strong admin password |
| `API_KEY` | Random API key (use `openssl rand -hex 32`) |
| `AUTH_SECRET` | Random secret (use `openssl rand -hex 32`) |
| `MC_ALLOW_ANY_HOST` | `true` (or set `MC_ALLOWED_HOSTS`) |
| `OPENCLAW_GATEWAY_HOST` | Your gateway host |
| `OPENCLAW_GATEWAY_PORT` | `18789` |

#### Preview/Dev (`develop` branch only)

Same as production but use the **Neon dev branch** connection string for `DATABASE_URL`.

In Vercel, set environment variables per-branch:
- Go to project → Settings → Environment Variables
- Click a variable → select specific branches (uncheck Production, check Preview)

### 6. Deploy

Push to `develop` to get a preview URL.
Push to `main` to deploy to production.

---

## Neon Database Branching

Neon branches are instant — they copy from the main branch at a point in time.

```
main branch (production) ──────────────────────→
                    ↘
                     dev branch (preview/develop) ──→
```

To create the dev branch:
1. Neon console → your project → Branches → **New Branch**
2. Name it `dev`, branch from `main`
3. Get the connection string for the `dev` branch
4. Set this as `DATABASE_URL` for Vercel preview environments

---

## Drizzle Migrations

To apply schema changes:

```bash
# Generate migration files from schema changes
npx drizzle-kit generate

# Apply to target DB
DATABASE_URL=<connection-string> npx drizzle-kit migrate
```

Migration files live in `./drizzle/` — commit them to git.

---

## Local Development

For local dev, you can:
1. Use the Neon dev branch directly (recommended)
2. Or run a local Postgres: `docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`

Set `DATABASE_URL` in `.env.local`:
```
DATABASE_URL=postgres://user:password@ep-xxx.neon.tech/dbname?sslmode=require
```
