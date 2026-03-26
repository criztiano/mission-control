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
