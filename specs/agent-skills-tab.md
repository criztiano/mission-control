# Agent Skills Tab

## Overview

Add a "Skills" tab to the agent detail modal that shows all available skills with per-agent enable/disable toggles, and an edit mode for viewing/editing SKILL.md content.

## Data Layer

### Skill Discovery

Skills live on the filesystem in multiple locations:
- **Global:** `~/.openclaw/skills/` (symlinks to `~/.agents/skills/`)
- **npm built-in:** `/opt/homebrew/lib/node_modules/openclaw/skills/`
- **Agent workspace:** `<agent.workspace>/skills/` (e.g. `~/clawd/skills/`, `~/cody/skills/`)

A skill is any directory containing a `SKILL.md` file. The directory name is the skill ID.

Each `SKILL.md` has YAML frontmatter with at minimum:
```yaml
---
name: skill-name
description: What the skill does
---
```

### API Endpoint: GET /api/agents/[id]/skills

Returns all discoverable skills with their enable/disable state for the given agent.

Response:
```json
{
  "skills": [
    {
      "id": "github",
      "name": "github",
      "description": "GitHub operations via gh CLI...",
      "source": "global",  // "global" | "npm" | "workspace"
      "enabled": true,
      "skillMdPath": "/path/to/SKILL.md"
    }
  ]
}
```

**How to determine "enabled" for an agent:**
- Check if a symlink or directory for that skill exists in the agent's workspace `skills/` dir
- If the agent has no workspace skills dir, all globally available skills are considered enabled (OpenClaw default behaviour)
- Skills explicitly in the agent's workspace `skills/` dir = definitely enabled for that agent

For the initial implementation, use a simple approach:
1. Scan all skill directories (global + npm + workspace)
2. Deduplicate by skill ID (workspace takes precedence over global, global over npm)
3. Return the merged list

### API Endpoint: PUT /api/agents/[id]/skills/[skillId]

Toggle a skill on/off for a specific agent.

Request body:
```json
{ "enabled": true }
```

**Implementation:** Create or remove a symlink in the agent's workspace `skills/` directory.
- Enable: `ln -s <source_skill_path> <workspace>/skills/<skill_id>`
- Disable: `rm <workspace>/skills/<skill_id>` (only if it's a symlink, never delete actual skill dirs)

Create the workspace `skills/` directory if it doesn't exist.

### API Endpoint: GET /api/agents/[id]/skills/[skillId]/content

Returns the raw markdown content of SKILL.md for viewing/editing.

Response:
```json
{
  "content": "# Skill Name\n\n...",
  "path": "/absolute/path/to/SKILL.md",
  "readOnly": true  // true if npm-sourced (not editable)
}
```

### API Endpoint: PUT /api/agents/[id]/skills/[skillId]/content

Save edited SKILL.md content. Only allowed for non-npm skills (global and workspace skills are editable).

Request body:
```json
{ "content": "# Updated skill content..." }
```

## UI Component: SkillsTab

### Location
Add to `src/components/panels/agent-detail-tabs.tsx` as a new exported component `SkillsTab`.

### Tab Registration
Add to the tabs array in `agent-squad-panel-phase3.tsx`:
```js
{ id: 'skills', label: 'Skills', icon: '⚡' }
```
Place it after "Files" and before "Tasks".

### List View (default)

Shows a list of all skills. Each row has:
- **Skill name** (bold)
- **Description** (one line, truncated, muted text)
- **Source badge**: `global`, `npm`, or `workspace` — use a small PropertyChip or text label
- **Toggle switch** on the right: enabled/disabled for this agent
- **Click row** → opens edit/view mode for that skill

Sort: enabled skills first, then alphabetically.

### Edit/View Mode

When a skill row is clicked, show the SKILL.md content in a **BlockEditor** (BlockNote component).

- If `readOnly: true` (npm source): BlockEditor in read-only mode
- If `readOnly: false`: BlockEditor is editable, with a save button
- Back button to return to list view

### Styling
- Follow existing tab patterns (see `FilesTab`, `MemoryTab` for reference)
- Use `Button` component for all buttons (outline variant for secondary actions)
- Dark theme tokens: `bg-card`, `text-foreground`, `border-border`
- Toggle switches: use a simple custom toggle or a styled checkbox

## Agent Workspace Paths

The API needs to know each agent's workspace path. This comes from the OpenClaw config:
- Config file: `~/.openclaw/openclaw.json`
- Path: `agents.list[].workspace`
- Agent IDs: `main` (workspace: `~/clawd`), `cody` (workspace: `~/cody`), `bookworm` (workspace: `~/bookworm`)

## Constraints

- Use the project's `Button` component for all buttons — never raw `<button>`
- Multi-line text editing must use `BlockEditor` (BlockNote)
- Dark theme first
- Icons from `iconoir-react` or inline SVGs
- No new npm dependencies
