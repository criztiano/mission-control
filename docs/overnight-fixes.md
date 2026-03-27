# Eden Overnight Fixes — 2026-03-26/27

## Already fixed (before overnight run)

### Earlier today (Cseno)
- **Missing await** on garden, xfeed, garden/[id], garden/stats, xfeed/stats, tasks/[id]/seen, auth/users
- **Table alias bug** in getIssues WHERE clause (Drizzle schema refs vs SQL alias)

### Earlier tonight (Piem session 1)
- **Missing await** on tasks/[id]/turns/[turnId] (updateTurn), xfeed/[id] (rateTweet, pinTweet, triageUpdate, updateTweetSummary), garden/[id] (updateGardenItem, deleteGardenItem), garden/[id]/classify (updateGardenItem), auth/logout (destroySession)
- **DB indexes** added: idx_turns_task_created, idx_comments_issue_created, idx_tweets_scraped_triage, idx_issues_archived_updated

---

## Overnight fixes (cron loop)

<!-- Piem will append fixes below this line -->

## Fix 3: Drizzle array-in-sql bug in notifications + pipelines routes
- **Files:** `src/app/api/notifications/route.ts`, `src/app/api/pipelines/route.ts`
- **Issue:** Both routes used `ANY(${jsArray}::text[])` inside a Drizzle `sql\`\`` template. Drizzle expands a JS array as a PostgreSQL record/tuple `($1,$2,...,$N)`, so `ANY(($1,$2,...)::text[])` fails with `cannot cast type record to text[]`. notifications was triggered when comment-type notifications exist; pipelines when creating a pipeline with multiple steps.
- **Fix:** Replaced `ANY(${array}::type[])` with `IN (${sql.join(array.map(id => sql\`${id}\`), sql\`, \`)})` — individual bound params, same pattern used in the agents fix.
- **Verify:** `pnpm build` passes ✓, no remaining `ANY(\${` patterns in src/app/api/
- **Commit:** 0ebb887 (develop)

## Fix 2: GET /api/agents 500 — Drizzle array-in-sql template bug
- **File:** `src/app/api/agents/route.ts`
- **Issue:** Drizzle ORM expands a JS array inside `sql\`\`` as a PostgreSQL record/tuple `($1,$2,...,$N)`, not a `text[]`. The query `WHERE LOWER(assignee) = ANY(${agentNames}::text[])` generated `ANY(($1,$2,...,$7)::text[])`, which Postgres rejects with: `cannot cast type record to text[]`.
- **Fix:** Replaced `ANY(${agentNames}::text[])` with `IN (${sql.join(agentNames.map(n => sql\`${n}\`), sql\`, \`)})` — each name becomes an individual bound parameter, no array cast needed.
- **Verify:** Drizzle `db.execute` returns 4 rows against Neon ✓, `pnpm build` passes ✓
- **Commit:** ea9e130 (develop)

## Fix 1: Batch notification source lookups (N+1 → 3 queries)
- **File:** `src/app/api/notifications/route.ts`
- **Issue:** GET /api/notifications ran one DB query per notification to enrich task/comment/agent source details — O(N) queries with N = up to 500 rows
- **Fix:** Collect all source IDs by type, batch-fetch with 3 parallel queries (`inArray` + `ANY`), then map via in-memory Maps — no async in the final `.map()`
- **Verify:** Build passes (`pnpm build` ✓), endpoint now returns source details with 3 queries regardless of result count
- **Commit:** 6df8c55 (develop)

## Fix 4: Merge develop→main to ship all fixes to production
- **File:** `src/app/api/agents/route.ts` (+ notifications, pipelines, tasks — all from develop)
- **Issue:** Production (eden-iota-one.vercel.app) still pointed to main branch which was never updated. All overnight fixes on develop were not in production — `/api/agents` returned 500 because main still had `ANY(${agentNames}::text[])` Drizzle array bug.
- **Fix:** `git merge develop` on main, pushed to origin main. Vercel auto-deployed production from main.
- **Verify:** `pnpm build` ✓, `/api/agents` now returns 14 agents (was 500 before)
- **Commit:** 18d2d1a (main)

## Fix 5: Missing await on logActivity in sessions/[id]/control
- **File:** `src/app/api/sessions/[id]/control/route.ts`
- **Issue:** `db_helpers.logActivity(...)` called without `await` — the async write was fire-and-forget, meaning if the DB call failed it would be silently swallowed and activity wouldn't be logged when pausing/monitoring/terminating sessions
- **Fix:** Added `await` before `db_helpers.logActivity(...)` so errors surface properly and the activity record is guaranteed to be written before returning the response
- **Verify:** `pnpm build` passes ✓, no remaining un-awaited `db_helpers.logActivity` calls in src/app/api/
- **Commit:** a5563f5 (develop)

## Fix 6: sql.raw() injection risk in tasks/pick — replace with bound params
- **File:** `src/app/api/tasks/pick/route.ts`
- **Issue:** `sql.raw(assigneesStr)` was used to build an `IN (...)` clause with manually-escaped string values — a `sql.raw()` pattern that bypasses Drizzle's parameterization. Same class of bug as the agents fix (Fix 2/3), just using manual escaping instead of array cast.
- **Fix:** Replaced `sql.raw(assigneesStr)` with `sql.join(assignees.map(a => sql\`${a}\`), sql\`, \`)` — each value is a proper bound parameter. Also removed unused `issues` schema import.
- **Verify:** `pnpm build` passes ✓, no remaining `sql.raw()` calls in src/app/api/
- **Commit:** c5e93dd (develop)

## Fix 7: Audit log default limit 1000→50, max 10000→500
- **File:** `src/app/api/audit/route.ts`
- **Issue:** GET /api/audit defaulted to returning 1000 rows with no reasonable cap (max 10000). Production response was ~197KB for an unfiltered request — way too heavy for a default list endpoint.
- **Fix:** Changed default `limit` from `1000` to `50`, max cap from `10000` to `500`. Full history can still be paginated via `?limit=500&offset=N`.
- **Verify:** `pnpm build` passes ✓, `/api/audit` now returns 50 rows (~10KB) by default
- **Commit:** c1dd353 (develop)
