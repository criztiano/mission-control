import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const SKILL_DIRS = [
  path.join(os.homedir(), '.agents/skills'),
  path.join(os.homedir(), '.openclaw/skills'),
  path.join(os.homedir(), '.openclaw/workspaces/main/skills'),
]

// Find npm global skills dir
const NODE_VERSION_DIR = path.join(os.homedir(), '.nvm/versions/node')
function findNpmSkillsDir(): string | null {
  try {
    if (!fs.existsSync(NODE_VERSION_DIR)) return null
    const versions = fs.readdirSync(NODE_VERSION_DIR)
    for (const v of versions) {
      const p = path.join(NODE_VERSION_DIR, v, 'lib/node_modules/openclaw/skills')
      if (fs.existsSync(p)) return p
    }
  } catch {}
  return null
}

const ALL_TOOLS = [
  'read', 'write', 'edit', 'exec', 'process',
  'web_search', 'web_fetch', 'image',
  'memory_search', 'memory_get',
  'cron', 'sessions_list', 'sessions_history', 'sessions_send',
  'sessions_spawn', 'sessions_yield', 'subagents', 'session_status',
  'browser', 'canvas', 'tts', 'message', 'gateway', 'nodes',
]

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Collect skills
  const skills = new Set<string>()
  const npmDir = findNpmSkillsDir()
  const dirs = [...SKILL_DIRS, ...(npmDir ? [npmDir] : [])]

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir)) {
        const skillFile = path.join(dir, entry, 'SKILL.md')
        if (fs.existsSync(skillFile)) {
          skills.add(entry)
        }
      }
    } catch {}
  }

  // Load skills catalog (categories + tags)
  let skillsCatalog: Record<string, any> = {}
  let categories: Record<string, any> = {}
  try {
    const catalogPath = path.join(os.homedir(), '.openclaw/workspaces/main/data/skills-catalog.json')
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
      skillsCatalog = catalog.skills || {}
      categories = catalog.categories || {}
    }
  } catch {}

  // Merge disk skills with catalog metadata
  const enrichedSkills = Array.from(skills).sort().map((id) => ({
    id,
    ...(skillsCatalog[id] || { category: 'uncategorized', tags: [] }),
  }))

  return NextResponse.json({
    tools: ALL_TOOLS.sort(),
    skills: enrichedSkills,
    categories,
  })
}
