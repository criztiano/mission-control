import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.openclaw/openclaw.json')

function getWorkspacePath(agentId: string): string | null {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    const defs: any[] = []
    for (const [, v] of Object.entries(config.agents || {})) {
      if (Array.isArray(v)) {
        for (const a of v) {
          if (typeof a === 'object') defs.push(a)
        }
      }
    }
    const agent = defs.find((a: any) => a.id === agentId)
    return agent?.workspace || null
  } catch {
    return null
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { agentId, file, content } = await request.json()
    if (!agentId || !file || content === undefined) {
      return NextResponse.json({ error: 'Missing agentId, file, or content' }, { status: 400 })
    }

    // Only allow SOUL.md and AGENTS.md
    if (!['SOUL.md', 'AGENTS.md'].includes(file)) {
      return NextResponse.json({ error: 'Only SOUL.md and AGENTS.md can be edited' }, { status: 400 })
    }

    const workspace = getWorkspacePath(agentId)
    if (!workspace) {
      return NextResponse.json({ error: `Workspace not found for agent ${agentId}` }, { status: 404 })
    }

    const filePath = path.join(workspace, file)

    // Preserve frontmatter if it exists
    let frontmatter = ''
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8')
      const fmMatch = existing.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
      if (fmMatch) {
        frontmatter = fmMatch[0]
      }
    }

    // Write the file with preserved frontmatter + new content
    const finalContent = frontmatter + content
    fs.writeFileSync(filePath, finalContent, 'utf-8')

    return NextResponse.json({ ok: true, agentId, file, path: filePath })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
