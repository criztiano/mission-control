import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { workflowPipelines, workflowTemplates, pipelineRuns } from '@/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { validateBody, createPipelineSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

export interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
}

/**
 * GET /api/pipelines - List all pipelines with enriched step data
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    // Fetch all 3 independent queries in parallel
    const [pipelines, templates, runCounts] = await Promise.all([
      db.select().from(workflowPipelines).orderBy(sql`use_count DESC, updated_at DESC`),
      db.select({ id: workflowTemplates.id, name: workflowTemplates.name }).from(workflowTemplates),
      db.execute(sql`
        SELECT pipeline_id, COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
        FROM pipeline_runs GROUP BY pipeline_id
      `),
    ])
    const nameMap = new Map(templates.map(t => [t.id, t.name]))
    const runMap = new Map((runCounts.rows as any[]).map(r => [r.pipeline_id, r]))

    const parsed = pipelines.map(p => {
      const steps: PipelineStep[] = JSON.parse(p.steps || '[]')
      return {
        ...p,
        steps: steps.map(s => ({ ...s, template_name: nameMap.get(s.template_id) || 'Unknown' })),
        runs: runMap.get(p.id) || { total: 0, completed: 0, failed: 0, running: 0 },
      }
    })

    return NextResponse.json({ pipelines: parsed })
  } catch (error) {
    console.error('GET /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 })
  }
}

/**
 * POST /api/pipelines - Create a pipeline
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createPipelineSchema)
    if ('error' in result) return result.error
    const { name, description, steps } = result.data

    // Validate template IDs
    const templateIds = steps.map((s: PipelineStep) => s.template_id)
    const existingTemplates = await db.execute(sql`SELECT id FROM workflow_templates WHERE id IN (${sql.join(templateIds.map((id: number) => sql`${id}`), sql`, `)})`)
    if (existingTemplates.rows.length !== new Set(templateIds).size) {
      return NextResponse.json({ error: 'One or more template IDs not found' }, { status: 400 })
    }

    const cleanSteps = steps.map((s: PipelineStep) => ({
      template_id: s.template_id,
      on_failure: s.on_failure || 'stop',
    }))

    const insertResult = await db.insert(workflowPipelines).values({
      name,
      description: description || null,
      steps: JSON.stringify(cleanSteps),
      created_by: auth.user?.username || 'system',
    }).returning({ id: workflowPipelines.id })

    const pipelineId = insertResult[0].id
    await db_helpers.logActivity('pipeline_created', 'pipeline', pipelineId, auth.user?.username || 'system', `Created pipeline: ${name}`)

    const pipeline = await db.select().from(workflowPipelines).where(eq(workflowPipelines.id, pipelineId)).limit(1)
    const p = pipeline[0]
    return NextResponse.json({ pipeline: { ...p, steps: JSON.parse(p.steps) } }, { status: 201 })
  } catch (error) {
    console.error('POST /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 })
  }
}

/**
 * PUT /api/pipelines - Update a pipeline
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 })

    const existingRows = await db.select().from(workflowPipelines).where(eq(workflowPipelines.id, id)).limit(1)
    if (!existingRows[0]) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const updateData: any = { updated_at: Math.floor(Date.now() / 1000) }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.steps !== undefined) updateData.steps = JSON.stringify(updates.steps)

    if (Object.keys(updateData).length === 1) {
      // Usage tracking
      updateData.use_count = sql`${workflowPipelines.use_count} + 1`
      updateData.last_used_at = Math.floor(Date.now() / 1000)
    }

    await db.update(workflowPipelines).set(updateData).where(eq(workflowPipelines.id, id))

    const updated = await db.select().from(workflowPipelines).where(eq(workflowPipelines.id, id)).limit(1)
    const p = updated[0]
    return NextResponse.json({ pipeline: { ...p, steps: JSON.parse(p.steps) } })
  } catch (error) {
    console.error('PUT /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 })
  }
}

/**
 * DELETE /api/pipelines - Delete a pipeline
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id
    if (!id) return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 })

    await db.delete(workflowPipelines).where(eq(workflowPipelines.id, parseInt(id)))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 })
  }
}
