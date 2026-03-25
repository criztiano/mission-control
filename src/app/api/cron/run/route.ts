import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { jobId } = body

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    // Run openclaw cron run <jobId> — this triggers the job asynchronously on the gateway
    // The command itself returns quickly, the actual job runs in the background
    try {
      const { stdout, stderr } = await execFileAsync(
        '/opt/homebrew/bin/openclaw',
        ['cron', 'run', jobId],
        { timeout: 30000 }
      )

      return NextResponse.json({
        ok: true,
        message: 'Cron job triggered',
        stdout: stdout.trim()
      })
    } catch (execError: any) {
      return NextResponse.json({
        ok: false,
        error: execError.message || 'Failed to run cron job',
        stderr: execError.stderr?.trim() || ''
      }, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
}
