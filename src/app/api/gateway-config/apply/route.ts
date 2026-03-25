import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { config } from '@/lib/config'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const bin = config.openclawBin || 'openclaw'

    let stdout = ''
    let stderr = ''
    let method = 'restart'

    try {
      const result = await execFileAsync(bin, ['gateway', 'restart'], {
        env: process.env,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      })
      stdout = result.stdout || ''
      stderr = result.stderr || ''
    } catch (restartErr: any) {
      const combined = `${restartErr?.stdout || ''}\n${restartErr?.stderr || ''}\n${restartErr?.message || ''}`
      if (!/not loaded|could not find specified service|launchd|systemd/i.test(combined)) {
        throw restartErr
      }

      method = 'stop-start'
      const stop = await execFileAsync(bin, ['gateway', 'stop'], {
        env: process.env,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      }).catch((err: any) => ({ stdout: err?.stdout || '', stderr: err?.stderr || err?.message || '' }))

      const start = await execFileAsync(bin, ['gateway', 'start'], {
        env: process.env,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      })

      stdout = `${stop.stdout || ''}\n${start.stdout || ''}`.trim()
      stderr = `${stop.stderr || ''}\n${start.stderr || ''}`.trim()
    }

    return NextResponse.json({ ok: true, method, stdout, stderr })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Failed to apply gateway config',
        stdout: error?.stdout || '',
        stderr: error?.stderr || '',
      },
      { status: 500 }
    )
  }
}
