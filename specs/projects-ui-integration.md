# Projects UI Integration

## Overview
Add project assignment and filtering to the task board UI. Tasks can belong to a project. Users can filter the board by project and assign/create projects from task modals.

## Current State
- `projects` table exists in DB with: id, title, description, emoji, archived
- `issues` table has `project_id` FK to projects
- API endpoints exist: `GET /api/projects` (list), `POST /api/projects/generate` (AI-create + assign)
- No project UI in task board yet

## Requirements

### 1. Project PropertyChip on Task Detail Modal
Add a Project PropertyChip to the TaskDetailModal (the modal that opens when clicking a task).

- Position: in the chips row alongside Status, Priority, Assignee chips
- Display: project emoji + project name (e.g. "🤖 Agent Squad")
- When no project: show "No project" placeholder
- Dropdown options: list of all projects from `GET /api/projects`
- **Last option in dropdown: "✨ New"** — when selected:
  - Show a small loading spinner on the chip
  - Call `POST /api/projects/generate` with `{ taskId }`
  - On success: chip updates to show the new project
  - On error: show the project name as fallback
- Selecting an existing project: update the task via `PUT /api/tasks` with `{ project_id }`
- Use `PropertyChip` component (same as status/priority/assignee)

### 2. Project PropertyChip on Create Task Modal
Same as detail modal but for the CreateTaskModal.

- Position: in the chips row with Priority and Assignee
- Selecting "✨ New" creates project and pre-assigns it
- Selecting existing project stores the project_id for task creation
- Default: no project selected

### 3. Project Filter in Board Header
Add a project filter dropdown to the task board header bar.

- Position: after the view toggle buttons (Board/List), before "New Task"
- Component: use a `<select>` styled as a `Button` variant="outline" size="sm", or a small dropdown
- Options: "All Projects" (default, shows everything) + list of projects (emoji + name)
- When a project is selected: filter the task list/board to only show tasks with that project_id
- Tasks with no project (project_id IS NULL) should show under "All Projects" but not under any specific project filter
- **Add an "Unassigned" filter option** that shows only tasks with no project

### 4. Project Chip on Task Cards
Show the project on each task card in both board and list views.

- Board view (kanban cards): small chip below the title showing emoji + project name, muted styling
- List view (table rows): add project column or show as a small chip alongside existing chips
- If no project: don't show anything (no "No project" chip on cards — too noisy)
- Chip styling: `text-xs text-muted-foreground` with emoji, no background — keep it subtle

### 5. API: Update task project_id
Ensure the existing `PUT /api/tasks` endpoint accepts and updates `project_id`.
- Check `src/app/api/tasks/route.ts` or `src/app/api/tasks/[id]/route.ts`
- If project_id field isn't handled yet, add it to the update logic
- Accept `null` to unassign a project

## Technical Notes
- All work is in `src/components/panels/task-board-panel.tsx` (main file)
- `PropertyChip` component already imported and used for status/priority/assignee
- `GET /api/projects` returns `{ projects: [{ id, title, description, emoji }] }`
- `POST /api/projects/generate` takes `{ taskId }` and returns `{ id, name, emoji, description, fallback? }`
- Projects should be fetched once on panel mount and cached in state (not re-fetched per modal open)
- **Tailwind v3.4** — use bracket syntax: `h-[var(--x)]` not `h-(--x)`, `z-[-1]` not `-z-1`
- Use `<Button>` component for any new buttons
- Use `BlockEditor` for any multi-line text areas

## Acceptance Criteria
- [ ] Build passes (`npx next build`)
- [ ] Task detail modal: Project PropertyChip shows current project, allows changing/creating
- [ ] Create task modal: Project PropertyChip with same functionality
- [ ] "✨ New" option calls `/api/projects/generate`, shows spinner, updates on success
- [ ] Board header: project filter dropdown with "All Projects", project list, and "Unassigned"
- [ ] Filtering works: selecting a project hides tasks from other projects
- [ ] Board view cards: subtle project chip (emoji + name) when project assigned
- [ ] List view rows: project visible as chip or column
- [ ] PUT /api/tasks supports project_id updates (including null to unassign)
- [ ] Dark mode looks correct throughout
- [ ] No raw `<select>` or `<button>` elements — use project components
