import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { provisionJobs, tenants } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { listProvisionJobs } from '@/lib/super-admin'

/**
 * GET /api/super/provision-jobs - List provisioning jobs
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const tenant_id = searchParams.get('tenant_id')
  const status = searchParams.get('status') || undefined
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)

  const jobs = listProvisionJobs({
    tenant_id: tenant_id ? parseInt(tenant_id, 10) : undefined,
    status,
    limit,
  })

  return NextResponse.json({ jobs })
}

/**
 * POST /api/super/provision-jobs - Queue an additional bootstrap/update job
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const tenantId = Number(body.tenant_id)
    const dryRun = body.dry_run !== false
    const jobType = String(body.job_type || 'bootstrap')

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
    }

    if (!['bootstrap', 'update', 'decommission'].includes(jobType)) {
      return NextResponse.json({ error: 'Invalid job_type' }, { status: 400 })
    }

    const tenantRows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    if (!tenantRows[0]) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    const plan = body.plan_json && Array.isArray(body.plan_json) ? body.plan_json : []
    const now = Math.floor(Date.now() / 1000)

    const result = await db.insert(provisionJobs).values({
      tenant_id: tenantId,
      job_type: jobType,
      status: 'queued',
      dry_run: dryRun,
      requested_by: auth.user.username,
      request_json: JSON.stringify(body.request_json || {}),
      plan_json: JSON.stringify(plan),
      updated_at: now,
    }).returning({ id: provisionJobs.id })

    const id = result[0].id
    const jobRows = await db.select().from(provisionJobs).where(eq(provisionJobs.id, id)).limit(1)

    return NextResponse.json({ job: jobRows[0] }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to queue job' }, { status: 500 })
  }
}
