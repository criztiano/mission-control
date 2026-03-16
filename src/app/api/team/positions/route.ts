import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const POSITIONS_PATH = path.join(
  os.homedir(),
  '.openclaw/workspaces/main/data/team-positions.json'
)

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    if (!fs.existsSync(POSITIONS_PATH)) {
      return NextResponse.json({ positions: {} })
    }
    const raw = fs.readFileSync(POSITIONS_PATH, 'utf-8')
    return NextResponse.json(JSON.parse(raw))
  } catch {
    return NextResponse.json({ positions: {} })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const dir = path.dirname(POSITIONS_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(POSITIONS_PATH, JSON.stringify(body, null, 2))
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
