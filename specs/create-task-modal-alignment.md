# Create Task Modal — Align with Task Detail Modal

## Overview
Update the CreateTaskModal component to match the visual style and component usage of the existing TaskDetailModal.

## Current State
The CreateTaskModal (line ~1095 in `task-board-panel.tsx`) uses raw HTML form elements:
- Plain `<input>` for title
- Plain `<textarea>` for description  
- Plain `<select>` for priority and assignee
- No tags input (just a text field)

## Target State
Match the TaskDetailModal's layout and component usage (line ~777 in same file).

## Requirements

### Title
- Use a simple borderless editable input — no `<label>`, no border, no background
- Same styling as the detail modal's title: `text-xl font-bold text-foreground bg-transparent` 
- Placeholder text: "Task title..."
- Auto-focus on modal open

### Description
- Use `BlockEditor` component (imported from `@/components/ui/block-editor`)
- Placeholder: "Add description..."
- Use `compact` prop
- NO raw `<textarea>` — BlockEditor is mandatory for multi-line editable text

### Priority
- Use `PropertyChip` component with `PRIORITY_OPTIONS` (already defined in file)
- Same usage as detail modal: `<PropertyChip value={priority} options={PRIORITY_OPTIONS} onSelect={...} colorFn={priorityColor} />`

### Assignee
- Use `PropertyChip` component with same `agents`-derived options as detail modal
- Include `searchable` prop
- Placeholder: user icon + "Unassigned" (same as detail modal)
- Options: "Unassigned" + Cri (in Humans group) + agents (in Agents group)

### Status
- Default to `open` — no need for a chip selector on create (it's always open)
- Do NOT add a status chip to the create modal

### Tags
- Remove the tags text field for now (tags can be added after creation via detail modal)

### Layout
- **Header area:** Title input (borderless, full width)
- **Chips row:** Priority + Assignee chips, `flex flex-wrap gap-2`
- **Body:** BlockEditor for description
- **Footer:** "Create Task" (default variant Button) + "Cancel" (outline variant Button)
- Modal width: `max-w-2xl` (same as detail modal, currently `max-w-md`)
- Dark mode is primary — all styling must look correct in dark theme

### Behaviour
- Submit via "Create Task" button or Cmd+Enter
- Cancel via "Cancel" button or Escape key
- Title is required (disable submit if empty)
- BlockEditor `onBlur` saves to local state (not to API — that happens on submit)

## Technical Notes
- Everything happens inside `task-board-panel.tsx` — the CreateTaskModal function component
- All components already imported: `PropertyChip`, `BlockEditor`, `Button`, `AgentAvatar`
- All option constants already defined: `PRIORITY_OPTIONS`, `priorityColor`
- Refer to TaskDetailModal (same file, line ~777) for exact component usage patterns
- **Tailwind v3.4** — use `h-[var(--x)]` not `h-(--x)`, `z-[-1]` not `-z-1`

## Acceptance Criteria
- [ ] Build passes (`npx next build`)
- [ ] Title input: borderless, auto-focused, placeholder "Task title...", `text-xl font-bold`
- [ ] Description: uses BlockEditor component with `placeholder="Add description..."` and `compact` prop
- [ ] Priority: uses PropertyChip with PRIORITY_OPTIONS and priorityColor
- [ ] Assignee: uses PropertyChip with searchable, agent avatars, grouped options
- [ ] No raw `<select>`, `<textarea>`, or `<input type="text">` for priority/assignee/description
- [ ] Title `<input>` is the only raw input (styled borderless)
- [ ] Modal width matches detail modal (`max-w-2xl`)
- [ ] Footer has "Create Task" (default) + "Cancel" (outline) Button components
- [ ] Escape closes modal, Cmd+Enter submits
- [ ] Submit disabled when title is empty
- [ ] Dark mode looks correct (no light backgrounds, proper contrast)
- [ ] Tags text field removed
- [ ] No status chip (defaults to `open` on submit)
