# Eden Task View — Redesign Spec

**Author:** Cseno + Cri  
**Date:** 2026-03-29  
**Status:** Approved  
**Figma:** 
- View: https://www.figma.com/design/br29nGPGakHgM1tUzqDE2N/Column-Design?node-id=5614-3477
- List item states: https://www.figma.com/design/br29nGPGakHgM1tUzqDE2N/Column-Design?node-id=5617-3663

---

## Overview

Complete redesign of the Eden task view. Prompt-driven task creation, split between personal task list and agent queue, project quick-filters, keyboard-first navigation, default/compressed view modes.

---

## 1. Layout Structure

### Top Bar — Project Filter + View Toggle
- **Left:** `ALL PROJECTS` dropdown button (opens full project list)
- **Center-left:** 3 most recently updated projects as inline quick-filter chips — each shows project name + open task count (open tasks in that project assigned to Cri)
- **Right:** Default / Compressed view toggle (two icon buttons)

### Main Area — My Tasks
- Shows only tasks **assigned to Cri** (human-facing: drafts, open, delivered)
- Agent-assigned tasks are **excluded** — they live in the Queue
- Ordered by most recently updated
- Each row: checkbox + title + project badge (colored pill)

### Bottom Panel — Queue + Prompt
- Collapsible **Queue** section: tasks currently assigned to agents
- Below queue: **Prompt Input** for task creation

---

## 2. Component Map

### From AI Elements (`elements.ai-sdk.dev`)

| Component | Registry path | Usage |
|-----------|--------------|-------|
| **Prompt Input** | `prompt-input` | Task creation input at the bottom |
| **Queue** | `queue` | Collapsible agent task queue above prompt |

**Prompt Input parts used:**
- `PromptInput`, `PromptInputTextarea`, `PromptInputSubmit`, `PromptInputBody`, `PromptInputFooter`

**Queue parts used:**
- `Queue`, `QueueSection`, `QueueSectionTrigger`, `QueueSectionLabel`, `QueueSectionContent`, `QueueList`, `QueueItem`, `QueueItemIndicator`, `QueueItemContent`

### Custom Components (built from scratch)

| Component | Purpose |
|-----------|---------|
| `TaskListItem` | Main list row — checkbox, title, project badge. States: default, hover, focused, selected, active |
| `TaskList` | Scrollable container with keyboard navigation logic |
| `ProjectFilterBar` | Top bar: ALL PROJECTS dropdown + 3 inline chips + view toggle |
| `ProjectChip` | Quick-filter chip: project name + count badge |
| `ViewToggle` | Default / Compressed switch |
| `TaskDetailPanel` | Expanded view when a task is opened (inline or side panel — per Figma) |

### From shadcn/ui (already in Eden)

- `Button`, `DropdownMenu` — ALL PROJECTS dropdown
- `Checkbox` — task selection
- `Badge` — project pill on list items
- `ScrollArea` — list scrolling
- `Collapsible` — used internally by Queue

---

## 3. Task Creation — Prompt-Driven

### Flow
1. User types a natural language description in the Prompt Input
2. Supports inline commands: `@agent` for assignment, `/project` for project targeting
3. On submit (Enter or send button), an LLM call processes the input
4. While processing: loading placeholder appears in Queue
5. LLM returns structured task (title, description, priority, project, assignee)
6. Task created via Eden API
7. Task appears in main list (if assigned to Cri) or Queue (if assigned to agent)

### Input syntax
- Plain text → task for Cri (draft)
- `@piem` / `@cody` / etc → assign to that agent (goes to Queue)
- `/eden` → assign to Eden project
- `/somename` → assign to existing project, or create new one if it doesn't exist
- `/new` → force new project creation (LLM invents name + description)
- Shift+Enter for newlines, Enter to submit

### API Endpoint

**`POST /api/tasks/create-from-prompt`**

Request:
```json
{
  "prompt": "string — raw user input",
  "active_project_filter": "string | null — currently active project filter in UI",
  "projects": [{ "id": "...", "name": "...", "description": "..." }],
  "agents": [{ "id": "...", "name": "...", "role": "..." }]
}
```

Response:
```json
{
  "task": {
    "id": "string",
    "title": "string",
    "description": "string",
    "priority": "normal | urgent",
    "assigned_to": "string",
    "project_id": "string | null"
  },
  "new_project": {
    "id": "string",
    "name": "string",
    "description": "string"
  } | null
}
```

---

## 4. LLM Task Creation — Policies

### Title Rules
- Start with a verb, concise, max 60 chars
- Use `–` (en dash) to separate context from action: `Eden API – Add batch delete endpoint`
- **Forbidden:** parentheses `()`, periods `.`, colons `:`, exclamation marks `!`, quotes
- **Forbidden:** filler words ("Please", "We need to", "Should"), status words ("TODO", "WIP", "URGENT")

### Description Rules
- First line: one sentence — what and why
- If non-trivial: bullet list of acceptance criteria
- Scannable, no walls of text
- Don't pad with fluff if the prompt is already clear

### Priority
- **`normal`** — always the default
- **`urgent`** — only when user explicitly says "urgent", "ASAP", "blocking", "broken in prod"
- Binary. No other levels.

### Assignment
- **Default: `cri`** — creates a draft in the main list
- **`@agent`** — only when user explicitly mentions an agent with `@`
- **Never infer an assignee.** Only assign to an agent when `@`'d.

### Project Assignment — Resolution Order

1. **Explicit `/slash`** (highest priority)
   - `/eden` → existing project "Eden"
   - `/somename` → existing project if found, else create new project "somename"
   - `/new` → force new project (LLM invents name + description)

2. **LLM inference** — match against injected project list (name + description). Assign if confident.

3. **Active filter fallback** — if a project filter is active in the UI, use it when LLM can't match.

4. **Auto-create for code tasks** — if the task involves code/building and no project matches:
   - LLM **must** create a new project (code tasks are never project-less)
   - Name: max 2 words, simple, descriptive
   - Description: 1 sentence, auto-generated, editable later
   - **Plan must include repo creation as step 1** for new-project tasks

5. **Null project** — allowed only for non-code tasks (operational, content, cleanup) where no project fits

### How the LLM determines "code task"
- Mentions building, creating, implementing, fixing, deploying
- References repos, APIs, components, features, bugs
- Targets dev agents (Cody, Piem)
- vs. operational tasks for Worm, Uze, Scramble → can be project-less

### System Prompt Context Injection

```
Available projects:
- Eden: Mission control app — tasks, plans, agents, dashboard
- Garden: Knowledge base and content ingestion system
- X Feed: Twitter/X content pipeline and engagement
- Overfeat: Daily AI tools digest (planned)
...

Available agents:
- @cseno: Team leader
- @piem: PM — plans and coordinates
- @cody: Builder — writes code
- @worm: Content intake
- @uze: Social posting
- @scottie: Ops and infrastructure
```

### New Project Auto-Creation

When a new project is created (via `/new`, `/somename` not found, or auto-create for code):
1. Project created in Eden: name (max 2 words), description (1 sentence), status `active`
2. Task assigned to that project
3. If routed to PM: plan **must include repo creation** as step 1
4. Name and description editable by Cri after creation

---

## 5. Task List Item — States

Per Figma (`5617-3663`):

| State | Visual |
|-------|--------|
| **Default** | Checkbox unchecked, normal text, project badge |
| **Hover** | Subtle background highlight |
| **Focused** | Visible focus ring (keyboard nav) |
| **Selected** | Checkbox checked |
| **Active** | Currently viewing/expanded — dashed border or distinct treatment |

---

## 6. Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus between task list items |
| `Space` | Toggle checkbox on focused item |
| `Enter` | Open/expand focused task |
| `Escape` | Close detail / deselect |
| `Tab` | Cycle sections: filter bar → task list → queue → prompt |
| `/` or `Cmd+K` | Focus the prompt input |

Focus must be visually obvious at all times.

---

## 7. Queue Panel

- Header: `▸ {count} QUEUED` (collapsible)
- Each item: status indicator + task title + assigned agent name (dimmed)
- Status indicators:
  - ⏳ Spinner — agent actively working
  - ○ Circle — queued, not yet picked up
  - ⏱ Clock — LLM creating task from prompt
- Auto-updates via polling or SSE from Eden API
- Click to expand inline or navigate to detail

---

## 8. Project Filter Bar

- `ALL PROJECTS` dropdown → full project list
- 3 inline project chips (most recently updated with open tasks assigned to Cri)
- Each chip: project name + count badge
- Click chip → filter main list to that project
- Active filter visually highlighted
- `→` separator between ALL PROJECTS and inline chips

---

## 9. View Modes

- **Default** — full spacing, all info visible (project badge, description preview if any)
- **Compressed** — tighter rows, smaller text, more tasks on screen
- Toggle persisted in localStorage (or Eden user preferences when available)

---

## 10. Data Requirements

### Endpoints needed

| Endpoint | Purpose |
|----------|---------|
| `GET /api/tasks?assigned_to=cri&status=open,delivered` | Main list |
| `GET /api/tasks?assigned_to=!cri&status=open,picked` | Queue (agent tasks) |
| `GET /api/projects?with_counts=true` | Project list + open task counts |
| `POST /api/tasks/create-from-prompt` | Prompt-driven task creation |
| `POST /api/projects` | New project creation (called by the prompt endpoint) |

### Real-time updates
- Queue should update when agents pick/complete tasks
- Options: polling (simple, 10s interval) or SSE (Eden already has SSE infrastructure)
