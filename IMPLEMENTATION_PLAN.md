# Implementation Plan

## CreateTaskModal Alignment — Gap Analysis Complete

**Reference:** TaskDetailModal (lines 777-1092)
**Target:** CreateTaskModal (lines 1095-1219)
**File:** `src/components/panels/task-board-panel.tsx`

---

## Prioritized Implementation Items

### 1. **Modal Width**
- [x] Change `max-w-md` to `max-w-2xl` (line 1137)
- Current: `<div className="... max-w-md w-full">`
- Target: `<div className="... max-w-2xl w-full max-h-[90vh] flex flex-col">`

### 2. **Replace Title Input**
- [x] Remove label "Title" (line 1143)
- [x] Replace bordered input with borderless, large input (lines 1144-1150)
- Current: `<label>` + `<input className="w-full bg-surface-1 ... border border-border ..."/>`
- Target: `<input className="w-full text-xl font-bold text-foreground bg-transparent focus:outline-none" placeholder="Task title..." autoFocus />`
- [x] Update state handler to maintain `formData.title`

### 3. **Replace Description Textarea with BlockEditor**
- [x] Remove label "Description" (line 1154)
- [x] Remove `<textarea>` (lines 1155-1160)
- [x] Add `BlockEditor` component with:
  - `initialMarkdown=""` (new task)
  - `onBlur={(md) => setFormData(prev => ({ ...prev, description: md }))}`
  - `placeholder="Add description..."`
  - `compact` prop
- [x] Update state to store markdown string from BlockEditor

### 4. **Replace Priority Select with PropertyChip**
- [x] Remove label "Priority" (line 1165)
- [x] Remove `<select>` (lines 1166-1175)
- [x] Add `PropertyChip` component:
  - `value={formData.priority}`
  - `options={PRIORITY_OPTIONS}` (already defined at line 748)
  - `onSelect={(v) => setFormData(prev => ({ ...prev, priority: v as Task['priority'] }))}`
  - `colorFn={priorityColor}` (already defined at line 765)

### 5. **Replace Assignee Select with PropertyChip**
- [x] Remove label "Assign to" (line 1179)
- [x] Remove `<select>` with agent options (lines 1180-1192)
- [x] Build grouped assignee options similar to detailAssigneeOptions (line 889-895):
  ```typescript
  const createAssigneeOptions: PropertyOption[] = [
    { value: '', label: 'Unassigned' },
    { value: 'cri', label: 'Cri', icon: <AgentAvatar agent="cri" size="sm" /> as React.ReactNode, group: 'Humans' },
    ...agents.filter(a => a.name.toLowerCase() !== 'cri').map(a => ({
      value: a.name, label: a.name, icon: <AgentAvatar agent={a.name} size="sm" /> as React.ReactNode, group: 'Agents',
    })),
  ]
  ```
- [x] Add `PropertyChip` component:
  - `value={formData.assigned_to}`
  - `options={createAssigneeOptions}`
  - `onSelect={(v) => setFormData(prev => ({ ...prev, assigned_to: v }))}`
  - `searchable`
  - `placeholder={<span className="flex items-center gap-1 text-muted-foreground/40"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg></span>}`

### 6. **Remove Tags Field**
- [x] Delete tags input div (lines 1195-1204)
- [x] Remove `tags` from `formData` state (line 1109)
- [x] Remove tags processing in submit handler (line 1121)

### 7. **Restructure Layout**
- [x] Move form `className` from "p-6" to structured layout:
  - Header area with title input
  - Chips row with `flex flex-wrap gap-2` containing Priority + Assignee
  - Body area with BlockEditor
  - Footer with buttons
- [x] Match detail modal structure:
  ```tsx
  {/* Header */}
  <div className="shrink-0 px-4 pt-3 pb-3 border-b border-border">
    <input {/* title */} />
    <div className="flex flex-wrap gap-2">
      <PropertyChip {/* priority */} />
      <PropertyChip {/* assignee */} />
    </div>
  </div>

  {/* Body */}
  <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
    <div className="-mx-1">
      <BlockEditor {/* description */} />
    </div>
  </div>

  {/* Footer */}
  <div className="shrink-0 px-4 py-3 border-t border-border">
    <div className="flex gap-2">
      <Button type="submit">Create Task</Button>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
    </div>
  </div>
  ```

### 8. **Update Button Styles**
- [x] Change button layout from `flex-1` to natural sizing
- [x] Ensure "Create Task" uses default variant (currently correct)
- [x] Ensure "Cancel" uses outline variant (currently correct)
- [x] Remove `flex-1` class from buttons

### 9. **Update Submit Handler**
- [x] Ensure `status` is set to `'open'` by default (not in form, just in submit)
- [x] Update API payload to exclude tags
- [x] Keep title required validation

### 10. **Add Keyboard Shortcuts**
- [x] Verify Escape closes modal (already handled at parent level, line 171-176)
- [x] Add Cmd+Enter submit via `onKeyDown` handler on form or modal wrapper

### 11. **Disable Submit When Title Empty**
- [x] Add `disabled={!formData.title.trim()}` to Create Task button

### 12. **Modal Backdrop Click Handler**
- [x] Verify backdrop click closes modal (already present at line 1136)

---

## Implementation Notes

- All required components are already imported: `PropertyChip`, `BlockEditor`, `Button`, `AgentAvatar` (line 10-13)
- All option constants are already defined: `PRIORITY_OPTIONS` (line 748), `priorityColor` (line 765), `statusColor` (line 755)
- AgentAvatar supports "cri" and agent names
- BlockEditor `onBlur` pattern is used in detail modal (line 1044)
- Tailwind v3.4 syntax applies (use `h-[var(--x)]` not `h-(--x)`)
- Dark mode is primary — all changes must look correct in dark theme
- Modal is already inside backdrop with `z-50` (line 1136)

---

## Acceptance Criteria Checklist

- [x] Build passes (`npx next build`)
- [x] Title input: borderless, auto-focused, placeholder "Task title...", `text-xl font-bold`
- [x] Description: uses BlockEditor with `placeholder="Add description..."` and `compact` prop
- [x] Priority: uses PropertyChip with PRIORITY_OPTIONS and priorityColor
- [x] Assignee: uses PropertyChip with searchable, agent avatars, grouped options (Humans/Agents)
- [x] No raw `<select>`, `<textarea>`, or labeled inputs (except title `<input>`)
- [x] Modal width is `max-w-2xl`
- [x] Footer has "Create Task" (default) + "Cancel" (outline) buttons
- [x] Escape closes modal (via parent handler)
- [x] Cmd+Enter submits form
- [x] Submit disabled when title is empty
- [x] Dark mode looks correct
- [x] Tags field removed
- [x] No status chip (defaults to `open` in API call)

---

STATUS: COMPLETE

All items implemented successfully. CreateTaskModal now matches TaskDetailModal design with:
- Modal width changed to `max-w-2xl`
- Borderless title input with auto-focus
- BlockEditor for description (replacing textarea)
- PropertyChip components for Priority and Assignee (replacing selects)
- Grouped assignee options (Humans/Agents) with avatars and searchable
- Tags field removed
- Restructured layout matching detail modal (header/body/footer)
- Keyboard shortcuts: Escape closes, Cmd+Enter submits
- Submit button disabled when title is empty
- Build validation passed with zero errors
