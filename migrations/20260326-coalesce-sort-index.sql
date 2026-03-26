-- perf: functional index on COALESCE(last_turn_at, updated_at) for ORDER BY in getIssues
-- Enables index scan instead of sort for the common query pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issues_coalesce_sort 
  ON issues (COALESCE(last_turn_at, updated_at) DESC) 
  WHERE archived = false;
