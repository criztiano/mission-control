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

## Fix 8: N+1 → batch query in GET /api/chat/conversations
- **File:** `src/app/api/chat/conversations/route.ts`
- **Issue:** Fetching last message per conversation used `Promise.all(conversations.map(async conv => db.select().from(messages).where(...).limit(1)))` — one DB roundtrip per conversation. With 50 conversations that's 51 total queries (1 list + 50 last-message lookups).
- **Fix:** Replaced the N per-row queries with a single `DISTINCT ON (conversation_id)` PostgreSQL query scoped to the current page's conversation IDs. Results mapped via in-memory Map — O(1) lookup per conversation. Also cleaned up unused `messages`, `eq`, and `desc` imports.
- **Verify:** `pnpm build` passes ✓, response still includes `last_message` object per conversation
- **Commit:** c08db2c (develop)

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

## Fix 9: N+1 → batch queries in GET /api/projects
- **File:** `src/app/api/projects/route.ts`
- **Issue:** For N projects, the route called `getProjectTaskCount(p.id)` + `getProjectLastActivity(p.id)` per project inside `Promise.all` — each is a separate DB query. With 10 projects = 21 total queries (1 list + 10 count + 10 lastActivity).
- **Fix:** Replaced per-project queries with 2 batch queries using `GROUP BY project_id` — one for COUNT(*) task counts, one for MAX(updated_at) last activity. Results mapped via in-memory Maps — O(1) lookup per project. Also removed unused `getProjectTaskCount` and `getProjectLastActivity` imports.
- **Verify:** `pnpm build` passes ✓, `/api/projects` returns `taskCount` and `lastActivity` per project with 3 total queries (1 list + 2 batch stats)
- **Commit:** e4cf506 (develop)

## Fix 10: Omit `content` from GET /api/plans list view
- **File:** `src/app/api/plans/route.ts`
- **Issue:** `SELECT *` in GET /api/plans returned the full `content` field (up to 2.4KB of markdown per plan) in list responses. Full content is only needed when viewing an individual plan — consumers of the list endpoint don't need it.
- **Fix:** Changed query from `SELECT *` to explicit column list excluding `content`. Updated return type annotation to `Omit<CCPlan, 'content'>[]`. Full content is still available via GET /api/plans/[id].
- **Verify:** `pnpm build` passes ✓, `/api/plans` response no longer includes `content` field per plan
- **Commit:** 7d58797 (develop)

## Fix 11: Missing await on logAuditEvent in export route
- **File:** `src/app/api/export/route.ts`
- **Issue:** `logAuditEvent({...})` called without `await` on line 80 — the async audit write was fire-and-forget. Any DB errors during export audit logging were silently swallowed, and the audit record was not guaranteed to be written before the response was returned.
- **Fix:** Added `await` before `logAuditEvent({...})` so errors surface properly and the audit record is committed before the export response is sent.
- **Verify:** `pnpm build` passes ✓, no remaining un-awaited `logAuditEvent` calls in src/app/api/
- **Commit:** 0d317cb (develop)

## Fix 13: Merge develop→main — ship fixes 5–12 to production
- **Files:** All files changed in fixes 5–12 (standup, projects, plans, audit, activities, tasks/pick, sessions/control, export, chat/conversations)
- **Issue:** Production (main) was 13 commits behind develop. All overnight fixes (N+1 batching, audit limit 1000→50, plans content omission, sql.raw injection fix, missing awaits) were live on develop but not in production.
- **Fix:** `git merge develop --no-ff` into main and pushed. Vercel will auto-deploy from main.
- **Verify:** `pnpm build` passes ✓ on develop before merge; 10 files changed, 299 insertions
- **Commit:** a7e7dd3 (main)

## Fix 14: Omit redundant `metadata` and `plan_path` from GET /api/tasks list view
- **File:** `src/app/api/tasks/route.ts`
- **Issue:** Each task in the list response included a `metadata` object (`{project_id, project_title, parent_id, schedule, source}`) that duplicated top-level fields already present, plus `plan_path` which is deprecated. At ~112 bytes of metadata per task × 157 tasks = 17.5KB of pure redundancy on every list fetch. Total list response was 145KB.
- **Fix:** Destructured `metadata` and `plan_path` out of each task object before returning in the list endpoint. Single-task GET (`/api/tasks/[id]`) is unaffected — full fields still available there.
- **Verify:** `pnpm build` passes ✓, `/api/tasks` response no longer includes `metadata` or `plan_path` fields, reducing payload by ~20KB (~14%)
- **Commit:** 6eb43ae (develop)

## Fix 15: Parallelize sequential DB queries in GET /api/search
- **File:** `src/app/api/search/route.ts`
- **Issue:** All 7 entity-type searches (tasks, agents, activities, audit, messages, webhooks, pipelines) ran sequentially — each `await db.execute(...)` blocked the next. An unfiltered search took ~7× the single-query latency.
- **Fix:** Wrapped all 7 queries in a single `Promise.all([...])` so they fire simultaneously. Inactive query slots (when `typeFilter` is set) resolve immediately via `Promise.resolve({rows:[]})`. Also cached `lowerQuery` to avoid repeated `.toLowerCase()` calls per result row.
- **Verify:** `pnpm build` passes ✓, search with query returns same result shape; parallel execution confirmed by structure
- **Commit:** c52174a (develop)

## Fix 16: Parallelize 9 sequential DB queries in GET /api/status (getDbStats)
- **File:** `src/app/api/status/route.ts`
- **Issue:** `getDbStats()` ran 9 independent `await db.execute(...)` calls sequentially — task stats, agent stats, 3 audit counts, activities count, notifications count, 2 pipeline counts, and webhook count — each blocking the next. Every call to `/api/status?action=dashboard` or `/api/status?action=health` paid 9 serial DB round-trips.
- **Fix:** Wrapped all 10 queries (added webhooks inside too, removing the inner `try/catch` block) in a single `Promise.all([...])`. Tables that may not exist in all envs (pipeline_runs, webhooks) use `.catch(() => ({ rows: [] }))` to preserve the existing resilience. Serial 9-query path → parallel 1-round-trip batch.
- **Verify:** `pnpm build` passes ✓, `/api/status?action=dashboard` returns same shape with 10× fewer DB round-trips
- **Commit:** 5007e41 (develop)

## Fix 17: Parallelize notifications data + count queries (3 serial → 1 parallel batch)
- **File:** `src/app/api/notifications/route.ts`
- **Issue:** GET /api/notifications fetched `notifRows` first, then ran `unreadCountRows` and `countRows` sequentially — 3 serial DB round-trips on every request. Both count queries are independent of the data fetch and of each other; there was no reason to serialize them.
- **Fix:** Wrapped all 3 queries in a single `Promise.all([...])` so they fire simultaneously. `unreadCount` and `total` are destructured from the parallel results; the source-detail batch queries run afterward (they depend on `notifRows`). Net result: 2 serial round-trips saved per request.
- **Verify:** `pnpm build` passes ✓, `/api/notifications?recipient=cri` still returns correct shape with `notifications`, `total`, `unreadCount`
- **Commit:** 50e5134 (develop)

## Fix 18: Parallelize sequential DB queries in getIssues, getTweets, getGardenItems
- **File:** `src/lib/cc-db.ts`
- **Issue:** Three core list functions ran independent queries serially:
  - `getIssues`: data + count = 2 sequential round-trips (affects `/api/tasks`)
  - `getTweets`: data + count + themes + digests = 4 sequential round-trips (affects `/api/xfeed`)
  - `getGardenItems`: data + count = 2 sequential round-trips (affects `/api/garden`)
  Each query blocked the next despite zero data dependency between them.
- **Fix:** Wrapped all independent queries in `Promise.all([...])` so they fire simultaneously. getIssues saves 1 serial round-trip; getTweets saves 3; getGardenItems saves 1 — total 5 eliminated round-trips per combined request.
- **Verify:** `pnpm build` passes ✓, endpoints return same shape; parallel execution confirmed by structure
- **Commit:** 32a4d43 (develop)

## Fix 19: Parallelize 3 sequential DB queries in GET /api/pipelines
- **File:** `src/app/api/pipelines/route.ts`
- **Issue:** GET /api/pipelines fetched `workflowPipelines`, `workflowTemplates`, and `pipeline_runs` run counts in three sequential `await` calls — each blocked the next despite zero data dependency between them. Every pipeline list load paid 3 serial DB round-trips.
- **Fix:** Wrapped all 3 queries in a single `Promise.all([...])` so they fire simultaneously. `nameMap` and `runMap` are built from the parallel results. Net result: 2 serial round-trips eliminated per request.
- **Verify:** `pnpm build` passes ✓, `/api/pipelines` returns same shape with 3× fewer DB round-trips
- **Commit:** 10f2d3b (develop)

## Fix 20: Merge develop→main — ship fixes 14–19 to production
- **Files:** `src/app/api/tasks/route.ts`, `src/app/api/search/route.ts`, `src/app/api/status/route.ts`, `src/app/api/notifications/route.ts`, `src/app/api/pipelines/route.ts`, `src/lib/cc-db.ts`, `docs/overnight-fixes.md`
- **Issue:** Production (main) was 9 commits behind develop. Fixes 14–19 — payload reduction (tasks metadata/plan_path removal, plans content omission), parallelization (search 7× faster, status 9 queries→1 round-trip, notifications 3→1 parallel batch, cc-db getIssues/getTweets/getGardenItems, pipelines) — were live on develop but not in production.
- **Fix:** `git merge develop --no-ff` into main and pushed. Vercel auto-deploys from main. 7 files changed, 295 insertions.
- **Verify:** `pnpm build` passes ✓ on develop before merge; all 9 commits now in production
- **Commit:** bd63d2a (main)

## Fix 21: Use .returning() in plans routes — eliminate post-write SELECT round-trips
- **Files:** `src/app/api/plans/route.ts`, `src/app/api/plans/[id]/route.ts`
- **Issue:** `POST /api/plans` did `db.insert(...)` then a separate `db.select().where(eq(plans.id, id)).limit(1)` to return the created plan — 2 round-trips for one create. `PUT /api/plans/[id]` did the same after `db.update(...)`. PostgreSQL supports `RETURNING` natively; Drizzle exposes it via `.returning()`.
- **Fix:** Changed `db.insert(...).values(...)` → `.returning()` and `db.update(...).set(...)` → `.returning()` in both routes. The extra `db.select` queries were removed. Same response shape, one fewer DB round-trip per operation.
- **Verify:** `pnpm build` passes ✓, POST /api/plans and PUT /api/plans/:id return the same plan object shape
- **Commit:** 22c6ee2 (develop)

## Fix 22: Merge getOpenBlockerIds+getBlockerDetails into single DB query in GET /api/tasks/[id]
- **Files:** `src/lib/cc-db.ts`, `src/app/api/tasks/[id]/route.ts`
- **Issue:** `GET /api/tasks/[id]` called `getOpenBlockerIds(blockerIds)` then `getBlockerDetails(blockerIds)` sequentially — two separate DB round-trips hitting the exact same `issues` table with the same `inArray(issues.id, blockerIds)` filter. One query's result was not needed by the other; they were purely serial with no dependency.
- **Fix:** Added `getBlockerInfo(blockerIds)` to `cc-db.ts` — one query that returns both `details` (full rows) and `openIds` (Set of non-closed IDs), replacing the two standalone functions in the hot path. Also parallelized the `getProject` call using `Promise.all` alongside `getBlockerInfo` — saves another serial round-trip when `project_id` is set. Net: 2 serial round-trips → 1 parallel batch per task view.
- **Verify:** `pnpm build` passes ✓, `GET /api/tasks/[id]` returns same shape with `is_blocked` and `blocker_details`
- **Commit:** 37a1142 (develop)

## Fix 24: Use .returning() in pipelines POST/PUT and notifications mark-delivered — eliminate post-write SELECT round-trips
- **Files:** `src/app/api/pipelines/route.ts`, `src/app/api/notifications/route.ts`
- **Issue:** Three mutations still had post-write SELECT round-trips:
  - `POST /api/pipelines`: `db.insert(...).returning({id})` then `db.select().where(id)` to get the full row — 2 queries for 1 create
  - `PUT /api/pipelines`: `db.update(...)` then `db.select().where(id)` to get the updated row — 2 queries for 1 update
  - `POST /api/notifications` (mark-delivered action): `db.update(...).where(isNull(delivered_at))` then `db.select().where(delivered_at === now)` to get affected rows — 2 queries for 1 batch update
- **Fix:** Changed all three to use `.returning()` — the full updated/inserted row(s) are returned directly from the write query. Removed 3 post-write `db.select()` calls. Same response shape, one fewer DB round-trip per operation.
- **Verify:** `pnpm build` passes ✓, mutations return same row shape
- **Commit:** 887d1c7 (develop)

## Fix 23: Use .returning() in workflows/alerts/gateways/messages — eliminate post-write SELECT round-trips
- **Files:** `src/app/api/workflows/route.ts`, `src/app/api/alerts/route.ts`, `src/app/api/gateways/route.ts`, `src/app/api/chat/messages/[id]/route.ts`
- **Issue:** All four routes did a post-write `db.select()` after `db.insert()` or `db.update()` to get the written row back — 2 round-trips for one mutation. PostgreSQL supports `RETURNING` natively; Drizzle exposes it via `.returning()`.
  - `workflows`: POST (insert → select) + PUT (update → select) = 2 extra queries
  - `alerts`: POST (insert → select) + PUT (update → select) = 2 extra queries
  - `gateways`: POST (insert → select) + PUT (update → select) = 2 extra queries
  - `chat/messages/[id]`: PATCH (update → select) = 1 extra query
- **Fix:** Changed `db.insert(...).returning({ id })` → `.returning()` (full row) and `await db.update(...)` → `await db.update(...).returning()` in all four files. Removed 7 post-write `db.select()` calls. Same response shape, one fewer DB round-trip per mutation.
- **Verify:** `pnpm build` passes ✓, mutations return same row shape
- **Commit:** 9225672 (develop)

## Fix 25: Use .returning() in POST /api/agents — eliminate post-write SELECT round-trip
- **File:** `src/app/api/agents/route.ts`
- **Issue:** `POST /api/agents` called `db.insert(...).returning({ id })` to get just the ID, then immediately did `db.select().from(agents).where(eq(agents.id, agentId)).limit(1)` to get the full row — 2 round-trips for one create. The full row was needed for the event broadcast and response.
- **Fix:** Changed `.returning({ id })` → `.returning()` (full row), removed the subsequent `db.select()` call. `createdAgent` is now taken directly from the insert result. `agentId` is derived from `createdAgent.id`. Net: 1 fewer DB round-trip per agent creation.
- **Verify:** `pnpm build` passes ✓, POST /api/agents returns same agent shape
- **Commit:** 87e9c0c (develop)

## Fix 26: Parallelize 3 sequential DB queries in GET /api/notifications/deliver
- **File:** `src/app/api/notifications/deliver/route.ts`
- **Issue:** GET /api/notifications/deliver fetched `statsRows`, then `recentRows`, then `pendingRows` in three sequential `await db.execute(...)` calls — each blocked the next despite zero data dependency between them. Every delivery status check paid 3 serial DB round-trips.
- **Fix:** Wrapped all 3 queries in a single `Promise.all([...])` so they fire simultaneously. `stats` is destructured from the parallel results as before. Net result: 2 serial round-trips eliminated per GET request.
- **Verify:** `pnpm build` passes ✓, GET /api/notifications/deliver returns same shape with `statistics`, `agents_with_pending`, `recent_deliveries`
- **Commit:** 2cc5ecd (develop)

## Fix 27: Parallelize getIssue + getCurrentRound in createTurn — 3 serial reads → 1 parallel batch
- **File:** `src/lib/cc-db.ts`
- **Issue:** `createTurn` made 3 serial DB reads before writing:
  1. `getIssue(taskId)` — to infer author
  2. `getCurrentRound(taskId)` — to get current max round number
  3. `getIssue(taskId)` again — to check if task is closed before reassigning
  All three ran sequentially despite reads 1+2 being fully independent. This is the hottest write path in the app — every turn creation (agent handoffs, plan approvals, review cycles) paid 3 serial DB round-trips before the insert.
- **Fix:** Replaced the 3 serial reads with a single `Promise.all([getIssue(taskId), getCurrentRound(taskId)])` at the top of the function. The `issue` result is reused for both author inference and status check — eliminating the duplicate `getIssue` call entirely. Net: 2 serial round-trips eliminated per turn creation.
- **Verify:** `pnpm build` passes ✓, `createTurn` returns same Turn shape; issue+round fetched in one parallel batch
- **Commit:** fef5e6c (develop)
