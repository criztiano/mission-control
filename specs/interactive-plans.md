# Interactive Plans — Spec

**Status:** Ready for build

## Concept

Plans are **separate entities** — documents with formatted markdown and inline interactive components. They are NOT task descriptions. A plan gets linked to a task and opens in its own dedicated viewer page.

## Key Principles

1. **Plans are their own entity** with their own DB table and API
2. **Read-only viewer** — the plan page renders markdown + inline interactive components, no editing
3. **Components are interleaved** — polls, checklists, thumbs, approval gates appear inline within the markdown text, right where they contextually make sense
4. **Plans surface in multiple places:**
   - Linked from tasks (clickable link in task detail)
   - Shared via Discord (agent sends plan link)
   - Visible on project pages (all plans for tasks in that project)

## Interactive Component Syntax

Agents write plans in markdown. Interactive blocks use HTML comments (invisible in raw md, parsed by the viewer):

### Poll (single choice)
```md
Some context about the architecture decision...

<!-- poll: "Where should canvas state live?" -->
<!-- option: "SQLite table (simple, local)" -->
<!-- option: "JSON file in workspace (portable)" -->
<!-- option: "tldraw built-in sync (less control)" -->
<!-- comment: true -->

Moving on to the next section...
```

### Checklist (multi-select approval)
```md
<!-- checklist: "Phase 1 Scope" -->
<!-- check: "Custom GardenCard shape" -->
<!-- check: "Manual drag and drop" -->
<!-- check: "Persist canvas state" -->
<!-- check: "Dark theme" -->
```

### Thumbs (binary yes/no)
```md
<!-- thumbs: "Do you like the zone layout approach?" -->
<!-- comment: true -->
```

### Approval Gate
```md
<!-- approval: "Phase 1 Plan" -->
```

### Open Comment
```md
<!-- input: "Any other thoughts on this section?" -->
```

## Data Model

### `plans` table
```sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,           -- markdown with interactive comment blocks
  task_id TEXT,                    -- optional link to task
  project_id TEXT,                 -- optional link to project
  author TEXT NOT NULL,            -- who wrote it (agent name)
  status TEXT DEFAULT 'draft',     -- draft | review | approved | rejected
  responses TEXT DEFAULT '{}',     -- JSON: collected feedback responses
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Response structure (stored in `responses` JSON)
```json
{
  "poll-abc123": { "id": "poll-abc123", "kind": "poll", "question": "Where should...", "selected": "SQLite table", "comment": "keep it simple" },
  "checklist-def456": { "id": "checklist-def456", "kind": "checklist", "title": "Phase 1 Scope", "checked": [0, 1, 3], "unchecked": [2] },
  "thumbs-ghi789": { "id": "thumbs-ghi789", "kind": "thumbs", "question": "Do you like...", "vote": "up", "comment": "" },
  "approval-jkl012": { "id": "approval-jkl012", "kind": "approval", "title": "Phase 1 Plan", "approved": true, "comment": "ship it" }
}
```

## API

- `POST /api/plans` — create plan (title, content, task_id?, project_id?, author)
- `GET /api/plans` — list plans (filter by task_id, project_id, status)
- `GET /api/plans/:id` — get plan with responses
- `PUT /api/plans/:id` — update plan content or status
- `PUT /api/plans/:id/respond` — submit feedback responses (merges into responses JSON)
- `DELETE /api/plans/:id` — delete plan

## Pages

### `/plans/:id` — Plan Viewer
- **Read-only** markdown rendered with inline interactive components
- Header: title, author, status badge, linked task (clickable), linked project
- Components rendered inline within the markdown flow (not grouped at bottom)
- "Submit Feedback" sticky button at bottom — collects all responses
- After submission: components show selected state (read-only), status updates

### Task Detail
- If task has a linked plan: show a "📋 View Plan" chip/link below the description
- Clicking opens `/plans/:id` (or slide-in panel — TBD)
- Plan status visible on the chip (draft/review/approved/rejected)

### Project Page  
- Section showing all plans linked to tasks in the project
- List with: plan title, author, status, linked task title

## Existing Code to Reuse

Already built (keep these files):
- `src/lib/plan-parser.ts` — parser that splits markdown into segments (markdown + components), handles all 5 component types
- `src/components/ui/plan-components.tsx` — React components for poll, checklist, thumbs, approval, input + `usePlanResponses` hook

These work correctly and produce interleaved segments. The `/plans/:id` page just needs to map over `parsePlan(content)` and render each segment in order.

## Files to Create
- `src/app/api/plans/route.ts` — list + create
- `src/app/api/plans/[id]/route.ts` — get + update + delete
- `src/app/api/plans/[id]/respond/route.ts` — submit responses
- `src/app/plans/[id]/page.tsx` — plan viewer page
- DB migration in `src/lib/cc-db.ts` — create plans table

## Files to Modify
- `src/components/panels/task-board-panel.tsx` — add plan link chip in task detail
- `src/components/layout/nav-rail.tsx` — optional: add Plans section if we want a browse view

## Acceptance Criteria
- [ ] Plans are separate entities with their own API
- [ ] Plan viewer renders markdown + inline components interleaved (not grouped)
- [ ] Polls render as radio groups with optional comment
- [ ] Checklists render as checkboxes
- [ ] Thumbs render as 👍/👎 buttons with optional comment
- [ ] Approval gates render as approve/reject buttons with comment
- [ ] Open inputs render as text fields
- [ ] Submit Feedback saves responses to the plan
- [ ] After submission, components show read-only state with selections visible
- [ ] Tasks show a clickable plan link when a plan is attached
- [ ] Build passes

## Who Writes Plans (needs syntax knowledge)
- Piem — primary, writes plans for Cri approval
- Ralph — writes specs
- Cseno — writes proposals/specs
- Roach — writes optimization proposals
- Scottie — writes infra proposals
