# Agent Skills Tab - Implementation Plan

## Gap Analysis Summary

**Spec Location:** `specs/agent-skills-tab.md`

**What Exists:**
- ✅ Agent detail modal with tab system (`agent-squad-panel-phase3.tsx`)
- ✅ Tab component architecture (Overview, SOUL, Memory, Files, Tasks, Config, Activity)
- ✅ API pattern for agent resources (`/api/agents/[id]/...`)
- ✅ Agent workspace resolution (`lib/agent-workspace.ts`)
- ✅ UI components: `Button`, `PropertyChip`, `BlockEditor`
- ✅ File reading/writing utilities

**What's Missing:**
- ❌ No Skills tab in the agent modal
- ❌ No skill discovery/scanning logic
- ❌ No API endpoints for skills management
- ❌ No UI components for skills list/editor
- ❌ No symlink management for enabling/disabling skills

---

## Implementation Tasks (Prioritized)

### 1. **Backend: Skill Discovery Utility** ✅ COMPLETE
Create `src/lib/agent-skills.ts` with:
- `scanSkillDirectories(agentNameOrId: string)` → discovers skills from:
  - Global: `~/.openclaw/skills/`
  - npm: `/opt/homebrew/lib/node_modules/openclaw/skills/`
  - Workspace: `<workspace>/skills/`
- `parseSkillMd(skillPath: string)` → extracts YAML frontmatter (name, description)
- `isSkillEnabled(agentNameOrId: string, skillId: string)` → checks symlink/dir in workspace
- `enableSkill(agentNameOrId: string, skillId: string, sourcePath: string)` → create symlink
- `disableSkill(agentNameOrId: string, skillId: string)` → remove symlink (safety check: only if symlink)
- Deduplication logic: workspace > global > npm

### 2. **API: GET /api/agents/[id]/skills** ✅ COMPLETE
- Import skill discovery utilities
- Return array of skill objects:
  ```typescript
  {
    id: string
    name: string
    description: string
    source: "global" | "npm" | "workspace"
    enabled: boolean
    skillMdPath: string
  }
  ```
- Sort: enabled first, then alphabetical

### 3. **API: PUT /api/agents/[id]/skills/[skillId]** ✅ COMPLETE
- Accept `{ enabled: boolean }`
- Enable: create symlink to source skill directory
- Disable: remove symlink (with safety check)
- Return updated skill object

### 4. **API: GET /api/agents/[id]/skills/[skillId]/content** ✅ COMPLETE
- Read `SKILL.md` from the skill's source path
- Return:
  ```typescript
  {
    content: string
    path: string
    readOnly: boolean  // true for npm skills
  }
  ```

### 5. **API: PUT /api/agents/[id]/skills/[skillId]/content** ✅ COMPLETE
- Accept `{ content: string }`
- Validate: reject if skill is npm-sourced (readOnly)
- Write to `SKILL.md` file
- Return success/error

### 6. **UI: SkillsTab Component** (`agent-detail-tabs.tsx`) ✅ COMPLETE
Add new exported component with two modes:

**List View (default):**
- Fetch skills from `GET /api/agents/[id]/skills`
- Display table/list with columns:
  - Skill name (bold)
  - Description (one line, truncated, muted)
  - Source badge (PropertyChip or small span)
  - Toggle switch (enabled/disabled) → calls `PUT /api/agents/[id]/skills/[skillId]`
- Click row → switch to edit/view mode
- Sort: enabled first, then alphabetical

**Edit/View Mode:**
- Fetch skill content from `GET /api/agents/[id]/skills/[skillId]/content`
- Display in `BlockEditor` component
- If `readOnly: true` → BlockEditor in read-only mode, no save button
- If `readOnly: false` → BlockEditor editable, show Save button
- Back button → return to list view
- Save button → calls `PUT /api/agents/[id]/skills/[skillId]/content`

### 7. **Tab Registration** (`agent-squad-panel-phase3.tsx`) ✅ COMPLETE
- Add to `tabs` array in `AgentDetailModalPhase3`:
  ```typescript
  { id: 'skills', label: 'Skills', icon: '⚡' }
  ```
- Position: after 'files', before 'tasks'
- Add case in tab content rendering:
  ```typescript
  {activeTab === 'skills' && <SkillsTab agent={agent} />}
  ```

### 8. **Toggle Switch Component** (if needed)
- Reuse existing patterns or create simple checkbox-based toggle
- Should call API immediately on toggle
- Show loading state during API call
- Handle errors gracefully (revert toggle on failure)

---

## Implementation Order

**Phase 1: Backend Foundation**
1. Create `src/lib/agent-skills.ts` (skill discovery + management utilities)
2. Create `src/app/api/agents/[id]/skills/route.ts` (GET list)
3. Create `src/app/api/agents/[id]/skills/[skillId]/route.ts` (PUT toggle)

**Phase 2: API Completion**
4. Create `src/app/api/agents/[id]/skills/[skillId]/content/route.ts` (GET/PUT content)

**Phase 3: UI Implementation**
5. Add `SkillsTab` component to `src/components/panels/agent-detail-tabs.tsx`
6. Register tab in `agent-squad-panel-phase3.tsx`
7. Test toggle functionality
8. Test edit/view mode with BlockEditor

**Phase 4: Polish**
9. Add error handling and loading states
10. Add confirmation dialogs for risky operations
11. Test with all three skill sources (global, npm, workspace)
12. Verify symlink safety (never delete actual skill directories)

---

## Technical Notes

**Skill Path Resolution:**
- Global: `~/.openclaw/skills/` (symlink to `~/.agents/skills/`)
- npm: `/opt/homebrew/lib/node_modules/openclaw/skills/`
- Workspace: `${agent.config.workspace}/skills/`

**Safety Checks:**
- Before removing skill: verify it's a symlink using `fs.lstatSync()`
- Never delete actual skill directories, only symlinks
- Create workspace `skills/` directory if it doesn't exist

**YAML Parsing:**
- Use `gray-matter` (likely already in dependencies) or similar
- Extract frontmatter from SKILL.md files
- Fallback: name = directory name, description = "(No description)"

**Deduplication:**
- If same skill ID exists in multiple sources:
  - workspace > global > npm (workspace wins)
- Track source in skill object for UI display

---

## Files to Create/Modify

**New Files:**
- `src/lib/agent-skills.ts`
- `src/app/api/agents/[id]/skills/route.ts`
- `src/app/api/agents/[id]/skills/[skillId]/route.ts`
- `src/app/api/agents/[id]/skills/[skillId]/content/route.ts`

**Modified Files:**
- `src/components/panels/agent-detail-tabs.tsx` (add SkillsTab component)
- `src/components/panels/agent-squad-panel-phase3.tsx` (register Skills tab)

**Dependencies Check:**
- Verify `gray-matter` or similar YAML parser is available
- If not, add to package.json

---

## Testing Checklist

- [ ] Skills discovered from all three sources
- [ ] Deduplication works (workspace > global > npm)
- [ ] Toggle enables skill (creates symlink)
- [ ] Toggle disables skill (removes symlink safely)
- [ ] npm skills show as read-only in edit mode
- [ ] Global/workspace skills are editable
- [ ] Save button works for editable skills
- [ ] Back button returns to list view
- [ ] Error handling for missing workspace
- [ ] Error handling for invalid SKILL.md files
- [ ] Confirmation before dangerous operations
- [ ] UI updates immediately after toggle/save

---

## Assumptions & Decisions

1. **SKILL.md Format:** Must have YAML frontmatter with `name` and `description`
2. **Skill ID:** Directory name is the canonical skill ID
3. **Enable/Disable:** Implemented via symlinks (OpenClaw convention)
4. **Read-only Detection:** npm skills are always read-only
5. **No nested skills:** Only top-level directories in each skills/ folder
6. **Agent workspace required:** Skills feature requires agent to have a workspace configured

---

## Future Enhancements (Out of Scope)

- Bulk enable/disable all skills
- Skill templates / creation wizard
- Skill search/filter in list view
- Skill dependencies / conflict detection
- Skill version management
- Install new skills from registry
