# Vercel + Neon Deployment Guide

Eden (Mission Control) is deployed on Vercel with a Neon Postgres database.

---

## Neon Database Setup

### 1. Create Neon Project

1. Go to [neon.tech](https://neon.tech) and create a new project
2. Choose your region (closest to your Vercel region)
3. Note your **main branch connection string** — this is your production `DATABASE_URL`

Format:
```
postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require
```

### 2. Create a Dev Branch (for preview deploys)

In Neon dashboard, go to **Branches** → **Create Branch** from `main`:
- Name: `dev`
- This creates an isolated copy for preview deployments

### 3. Apply Schema

Run schema migrations against each environment:

```bash
# Against production (main Neon branch)
DATABASE_URL="postgresql://..." npx drizzle-kit migrate

# Against dev (Neon dev branch)
DATABASE_URL="postgresql://...dev-branch..." npx drizzle-kit migrate
```

Or generate SQL and apply manually:
```bash
npx drizzle-kit generate
# Review migrations in ./drizzle/
npx drizzle-kit migrate
```

---

## Vercel Project Setup

### 1. Connect Repository

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import `criztiano/mission-control` from GitHub
3. Framework: **Next.js** (auto-detected)

### 2. Branch Configuration

| Git Branch | Vercel Environment | Neon Branch |
|------------|-------------------|-------------|
| `main`     | Production        | `main`      |
| `develop`  | Preview           | `dev`       |
| `task/*`   | Preview           | `dev`       |

### 3. Environment Variables

Set these in Vercel dashboard under **Settings → Environment Variables**:

#### Required

| Variable | Description | Environment |
|----------|-------------|-------------|
| `DATABASE_URL` | Neon connection string | Production + Preview |
| `AUTH_USER` | Admin username (seeded on first run) | All |
| `AUTH_PASS` | Admin password | All |
| `API_KEY` | API key for agents | All |
| `AUTH_SECRET` | Session cookie secret | All |
| `MC_COOKIE_SECURE` | `true` on production | Production |

#### Optional

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth (public) |
| `DISCORD_BOT_TOKEN` | Discord notifications |
| `OPENCLAW_GATEWAY_HOST` | Gateway host |
| `OPENCLAW_GATEWAY_PORT` | Gateway port (default: 18789) |
| `NEXT_PUBLIC_GATEWAY_HOST` | Frontend gateway host |
| `NEXT_PUBLIC_GATEWAY_PORT` | Frontend gateway port |

For production, use the Neon **main branch** connection string.
For preview, use the Neon **dev branch** connection string.

### 4. Set DATABASE_URL per environment

In Vercel → Settings → Environment Variables:
- Add `DATABASE_URL` for **Production** → Neon main branch URL
- Add `DATABASE_URL` for **Preview** → Neon dev branch URL

---

## Data Migration (One-Time)

After deploying to production, migrate your local SQLite data to Neon:

```bash
cd ~/Projects/mission-control

# Install tsx if not present
npm install -D tsx better-sqlite3 @types/better-sqlite3

# Run migration (reads local SQLite, writes to Neon)
DATABASE_URL="postgresql://your-neon-url" npx tsx scripts/migrate-sqlite-to-postgres.ts
```

The script is idempotent — safe to run multiple times.

---

## Custom Server

Eden uses a custom Next.js server (`server.mjs`) for WebSocket proxying. On Vercel this is handled differently — Vercel uses the standard Next.js serverless functions.

**DO NOT use `node server.mjs`** on Vercel — it's for local development only.

---

## Post-Deploy Checklist

1. ✅ `DATABASE_URL` set in Vercel
2. ✅ Schema applied via `npx drizzle-kit migrate`
3. ✅ Data migrated via `scripts/migrate-sqlite-to-postgres.ts`
4. ✅ First login works (admin user seeded from `AUTH_USER`/`AUTH_PASS`)
5. ✅ Task creation works
6. ✅ Agent heartbeat works

---

## Neon Branching Workflow

```
Neon main  ←── production traffic
    │
    └── Neon dev  ←── preview/staging traffic (Vercel preview deployments)
```

Branches are **isolated copies** — changes to dev don't affect production.

To promote dev changes to main: run the migration script against production Neon.

---

## Troubleshooting

### "No database connection string"
→ `DATABASE_URL` not set in Vercel environment variables

### Schema not found / table doesn't exist
→ Run `npx drizzle-kit migrate` with the correct `DATABASE_URL`

### Auth fails after deploy
→ Check `AUTH_USER` and `AUTH_PASS` are set; these seed the admin user on first run when the users table is empty
