# Autoresearch Ideas — mission-control /api/tasks

## Priority Queue

### High Impact / Moderate Effort
1. **Reduce SELECT i.* to specific columns** — avoid fetching `description` (potentially large) when not needed for list view. Check what fields mapIssueToTask actually uses.
2. **Pre-compute sort column as stored/generated col** — `COALESCE(last_turn_at, updated_at)` used in ORDER BY. If stored, planner can use it directly without computing per-row.
3. **Denormalize last_turn_type/last_turn_by into issues table** — eliminates LATERAL JOIN entirely. Requires schema migration + trigger or write-path update.

### Medium Impact / Low Effort  
4. **Add `FETCH FIRST n ROWS ONLY` instead of LIMIT** — syntactic hint, minor planner effect on some PG versions.
5. **Connection pooling hints** — Neon supports `pool_mode=transaction`, check if already using pooler URL (it is: `-pooler.` in URL). Verify no session-mode features being used that block pooling.
6. **Tune LATERAL ORDER BY** — the LATERAL uses `ORDER BY t.created_at DESC LIMIT 1`. Check if index is being used via EXPLAIN.
7. **Try explicit index hints or force index scan** — `SET enable_seqscan = off` as session var before query.

### High Impact / High Effort
8. **Materialized view** — precompute issues+turns join. Needs refresh strategy.
9. **Split query into two** — fast issues metadata (no LATERAL) + slow LATERAL on just the IDs returned. Merge client-side. May win if the LATERAL is the bottleneck.
10. **Cache total count** — if `COUNT(*) OVER ()` is still expensive, cache it in-memory with TTL.

### Structural / Speculative
11. **Batch LATERAL joins into CTE with window functions** — was tried (discard), but with slightly different approach: pre-filter by known issue IDs first.
12. **Use Neon's HTTP batch endpoint** — send multiple SQL statements in one HTTP request. Could eliminate any remaining round-trips.
13. **Add `last_turn_type` and `last_turn_by` columns to issues table** — full denormalization, biggest structural win possible.

## Discarded
- CTE + DISTINCT ON: scans full table, no gain
