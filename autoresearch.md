# Autoresearch Charter — mission-control /api/tasks query performance

**Session:** 2026-03-26 (Night 2 — continuing from earlier session)
**Researcher:** Auwl 🦉
**Branch:** `perf/tasks-query-optimization`

## Goal
Minimize `getIssues({ limit: 50 })` response time against Neon (production DB).

## Metric Command
```bash
./autoresearch.sh
# Outputs: METRIC time_ms=<median of 3 runs>
```

## Direction
Lower is better (ms).

## Scope
- `src/lib/cc-db.ts` — primary
- Migration files in `src/db/migrations/` — for schema changes
- `src/db/schema.ts` — if adding denormalized columns

## Guard
`pnpm build` must pass (via `./autoresearch.checks.sh`)

## Current Baseline (Night 2 resume)
**~527ms** (samples: 532, 537, 511 — median 532ms)

Original Night 1 baseline was 808ms. Already achieved -35% improvement via:
1. LATERAL JOINs (replaced 3 correlated subqueries with 2 LATERAL JOINs)
2. Indexes on turns(task_id, created_at) and issue_comments(issue_id, created_at)
3. Window COUNT (eliminated separate COUNT(*) round-trip)
4. Partial index on issues(archived, last_turn_at, updated_at)

## What's Been Tried

| Experiment | Result | Note |
|------------|--------|------|
| LATERAL JOINs (replace 3 correlated subqueries) | keep -7.3% | commit 4540209 |
| Indexes on turns/issue_comments | keep -5.9% | commit 295365e |
| Window COUNT (eliminate COUNT round-trip) | keep -25.8% | commit 302c36c |
| Partial index on issues(archived, sort cols) | keep (DB applied) | commit c9d94c9 |
| CTE + DISTINCT ON for bulk turn/comment lookup | discard | no gain, worse at scale |

## Ideas Backlog
See autoresearch-ideas.md

## Notes
- The LATERAL JOIN approach is solid; main wins will now come from schema changes or connection-level optimizations
- Neon HTTP driver has per-request latency overhead (~100-150ms baseline network cost)
- Watch out for `i.*` — fetching all columns including large `description` text
