import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.openclaw/openclaw.json')

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { agentId, field, value } = await request.json()
    if (!agentId || !field) {
      return NextResponse.json({ error: 'Missing agentId or field' }, { status: 400 })
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)

    // Find agent definitions array
    let defs: any[] | null = null
    let defsKey: string = ''
    for (const [k, v] of Object.entries(config.agents || {})) {
      if (Array.isArray(v)) {
        defs = v as any[]
        defsKey = k
        break
      }
    }

    if (!defs) {
      return NextResponse.json({ error: 'No agent definitions found' }, { status: 500 })
    }

    const agent = defs.find((a: any) => a.id === agentId)
    if (!agent) {
      return NextResponse.json({ error: `Agent ${agentId} not found` }, { status: 404 })
    }

    // Apply changes based on field
    switch (field) {
      case 'model': {
        // value = { primary: string, fallbacks?: string[] }
        if (typeof value === 'string') {
          agent.model = value
        } else {
          agent.model = value
        }
        break
      }
      case 'skills': {
        // value = string[] (skill names)
        agent.skills = value
        break
      }
      case 'tools.deny': {
        // value = string[]
        if (!agent.tools) agent.tools = {}
        agent.tools.deny = value
        break
      }
      case 'tools.alsoAllow': {
        // value = string[]
        if (!agent.tools) agent.tools = {}
        agent.tools.alsoAllow = value
        break
      }
      default:
        return NextResponse.json({ error: `Unknown field: ${field}` }, { status: 400 })
    }

    // Write back
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))

    return NextResponse.json({ ok: true, agentId, field, value })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
