import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { workflowTemplates } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { validateBody, createWorkflowSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

/**
 * GET /api/workflows - List all workflow templates
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const templates = await db.select().from(workflowTemplates).orderBy(sql`use_count DESC, updated_at DESC`)
    const parsed = templates.map(t => ({ ...t, tags: t.tags ? JSON.parse(t.tags) : [] }))
    return NextResponse.json({ templates: parsed })
  } catch (error) {
    console.error('GET /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

/**
 * POST /api/workflows - Create a new workflow template
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createWorkflowSchema)
    if ('error' in result) return result.error
    const { name, description, model, task_prompt, timeout_seconds, agent_role, tags } = result.data

    const user = auth.user

    const insertResult = await db.insert(workflowTemplates).values({
      name,
      description: description || null,
      model,
      task_prompt,
      timeout_seconds,
      agent_role: agent_role || null,
      tags: JSON.stringify(tags),
      created_by: user?.username || 'system',
    }).returning({ id: workflowTemplates.id })

    const templateId = insertResult[0].id
    await db_helpers.logActivity('workflow_created', 'workflow', templateId, user?.username || 'system', `Created workflow template: ${name}`)

    const templateRows = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, templateId)).limit(1)
    const template = templateRows[0]

    return NextResponse.json({ template: { ...template, tags: template.tags ? JSON.parse(template.tags) : [] } }, { status: 201 })
  } catch (error) {
    console.error('POST /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows - Update a workflow template
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) return NextResponse.json({ error: 'Template ID is required' }, { status: 400 })

    const existingRows = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, id)).limit(1)
    if (!existingRows[0]) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

    const now = Math.floor(Date.now() / 1000)
    const updateData: any = { updated_at: now }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.model !== undefined) updateData.model = updates.model
    if (updates.task_prompt !== undefined) updateData.task_prompt = updates.task_prompt
    if (updates.timeout_seconds !== undefined) updateData.timeout_seconds = updates.timeout_seconds
    if (updates.agent_role !== undefined) updateData.agent_role = updates.agent_role
    if (updates.tags !== undefined) updateData.tags = JSON.stringify(updates.tags)

    if (Object.keys(updateData).length === 1) {
      updateData.use_count = sql`${workflowTemplates.use_count} + 1`
      updateData.last_used_at = now
    }

    await db.update(workflowTemplates).set(updateData).where(eq(workflowTemplates.id, id))

    const updatedRows = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, id)).limit(1)
    const updated = updatedRows[0]
    return NextResponse.json({ template: { ...updated, tags: updated.tags ? JSON.parse(updated.tags) : [] } })
  } catch (error) {
    console.error('PUT /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows - Delete a workflow template
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id
    if (!id) return NextResponse.json({ error: 'Template ID is required' }, { status: 400 })

    await db.delete(workflowTemplates).where(eq(workflowTemplates.id, parseInt(id)))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
