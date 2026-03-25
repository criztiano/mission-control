import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { db_helpers } from '@/lib/db'
import { workflowPipelines, workflowTemplates, pipelineRuns } from '@/db/schema'
import { eq, desc, inArray, sql } from 'drizzle-orm'
import { requireRole } from '@/lib/auth'
import { eventBus } from '@/lib/event-bus'

interface PipelineStep {
  template_id: number
  on_failure: 'stop' | 'continue'
}

interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  on_failure?: string
  spawn_id: string | null
  started_at: number | null
  completed_at: number | null
  error: string | null
}

/**
 * GET /api/pipelines/run - Get pipeline runs
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const pipelineId = searchParams.get('pipeline_id')
    const runId = searchParams.get('id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 200)

    if (runId) {
      const rows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, parseInt(runId))).limit(1)
      if (!rows[0]) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      const r = rows[0]
      return NextResponse.json({ run: { ...r, steps_snapshot: JSON.parse(r.steps_snapshot) } })
    }

    let runs
    if (pipelineId) {
      runs = await db.select().from(pipelineRuns)
        .where(eq(pipelineRuns.pipeline_id, parseInt(pipelineId)))
        .orderBy(desc(pipelineRuns.created_at))
        .limit(limit)
    } else {
      runs = await db.select().from(pipelineRuns)
        .orderBy(desc(pipelineRuns.created_at))
        .limit(limit)
    }

    const pipelineIds = [...new Set(runs.map(r => r.pipeline_id))]
    const pipelines = pipelineIds.length > 0
      ? await db.select({ id: workflowPipelines.id, name: workflowPipelines.name }).from(workflowPipelines).where(inArray(workflowPipelines.id, pipelineIds))
      : []
    const nameMap = new Map(pipelines.map(p => [p.id, p.name]))

    const parsed = runs.map(r => ({
      ...r,
      pipeline_name: nameMap.get(r.pipeline_id) || 'Deleted Pipeline',
      steps_snapshot: JSON.parse(r.steps_snapshot),
    }))

    return NextResponse.json({ runs: parsed })
  } catch (error) {
    console.error('GET /api/pipelines/run error:', error)
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }
}

/**
 * POST /api/pipelines/run - Start a pipeline run or advance a running one
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { action, pipeline_id, run_id } = body

    if (action === 'start') {
      return startPipeline(pipeline_id, auth.user?.username || 'system')
    } else if (action === 'advance') {
      return advanceRun(run_id, body.success ?? true, body.error)
    } else if (action === 'cancel') {
      return cancelRun(run_id)
    }

    return NextResponse.json({ error: 'Invalid action. Use: start, advance, cancel' }, { status: 400 })
  } catch (error) {
    console.error('POST /api/pipelines/run error:', error)
    return NextResponse.json({ error: 'Failed to process pipeline run' }, { status: 500 })
  }
}

async function spawnStep(
  pipelineName: string,
  template: { name: string; model: string; task_prompt: string; timeout_seconds: number },
  steps: RunStepState[],
  stepIdx: number,
  runId: number
): Promise<{ success: boolean; stdout?: string; error?: string }> {
  try {
    const { runOpenClaw } = await import('@/lib/command')
    const args = [
      'agent',
      '--message', `[Pipeline: ${pipelineName} | Step ${stepIdx + 1}] ${template.task_prompt}`,
      '--timeout', String(template.timeout_seconds),
      '--json',
    ]
    const { stdout } = await runOpenClaw(args, { timeoutMs: 15000 })

    const spawnId = `pipeline-${runId}-step-${stepIdx}-${Date.now()}`
    steps[stepIdx].spawn_id = spawnId
    await db.update(pipelineRuns).set({ steps_snapshot: JSON.stringify(steps) }).where(eq(pipelineRuns.id, runId))

    return { success: true, stdout: stdout.trim() }
  } catch (err: any) {
    steps[stepIdx].error = err.message
    await db.update(pipelineRuns).set({ steps_snapshot: JSON.stringify(steps) }).where(eq(pipelineRuns.id, runId))
    return { success: false, error: err.message }
  }
}

async function startPipeline(pipelineId: number, triggeredBy: string) {
  const pipelineRows = await db.select().from(workflowPipelines).where(eq(workflowPipelines.id, pipelineId)).limit(1)
  const pipeline = pipelineRows[0]
  if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

  const steps: PipelineStep[] = JSON.parse(pipeline.steps || '[]')
  if (steps.length === 0) return NextResponse.json({ error: 'Pipeline has no steps' }, { status: 400 })

  const templateIds = steps.map(s => s.template_id)
  const templates = await db.select().from(workflowTemplates).where(inArray(workflowTemplates.id, templateIds))
  const templateMap = new Map(templates.map(t => [t.id, t]))

  const stepsSnapshot: RunStepState[] = steps.map((s, i) => ({
    step_index: i,
    template_id: s.template_id,
    template_name: templateMap.get(s.template_id)?.name || 'Unknown',
    on_failure: s.on_failure,
    status: i === 0 ? 'running' : 'pending',
    spawn_id: null,
    started_at: i === 0 ? Math.floor(Date.now() / 1000) : null,
    completed_at: null,
    error: null,
  }))

  const now = Math.floor(Date.now() / 1000)
  const result = await db.insert(pipelineRuns).values({
    pipeline_id: pipelineId,
    status: 'running',
    current_step: 0,
    steps_snapshot: JSON.stringify(stepsSnapshot),
    started_at: now,
    triggered_by: triggeredBy,
  }).returning({ id: pipelineRuns.id })

  const runId = result[0].id

  await db.update(workflowPipelines).set({
    use_count: sql`${workflowPipelines.use_count} + 1`,
    last_used_at: now,
    updated_at: now,
  }).where(eq(workflowPipelines.id, pipelineId))

  const firstTemplate = templateMap.get(steps[0].template_id)
  let spawnResult: any = null
  if (firstTemplate) {
    spawnResult = await spawnStep(pipeline.name, firstTemplate, stepsSnapshot, 0, runId)
  }

  await db_helpers.logActivity('pipeline_started', 'pipeline', pipelineId, triggeredBy, `Started pipeline: ${pipeline.name}`, { run_id: runId })

  eventBus.broadcast('activity.created', {
    type: 'pipeline_started',
    entity_type: 'pipeline',
    entity_id: pipelineId,
    description: `Pipeline "${pipeline.name}" started`,
    data: { run_id: runId },
  })

  return NextResponse.json({
    run: {
      id: runId,
      pipeline_id: pipelineId,
      status: stepsSnapshot[0].status === 'failed' ? 'failed' : 'running',
      current_step: 0,
      steps_snapshot: stepsSnapshot,
      spawn: spawnResult,
    }
  }, { status: 201 })
}

async function advanceRun(runId: number, success: boolean, errorMsg?: string) {
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1)
  const run = runRows[0]
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running') return NextResponse.json({ error: `Run is ${run.status}, not running` }, { status: 400 })

  const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
  const currentIdx = run.current_step
  const now = Math.floor(Date.now() / 1000)

  steps[currentIdx].status = success ? 'completed' : 'failed'
  steps[currentIdx].completed_at = now
  if (errorMsg) steps[currentIdx].error = errorMsg

  const nextIdx = currentIdx + 1
  const onFailure = steps[currentIdx].on_failure || 'stop'

  if (!success && onFailure === 'stop') {
    for (let i = nextIdx; i < steps.length; i++) steps[i].status = 'skipped'
    await db.update(pipelineRuns).set({ status: 'failed', current_step: currentIdx, steps_snapshot: JSON.stringify(steps), completed_at: now }).where(eq(pipelineRuns.id, runId))
    return NextResponse.json({ run: { id: runId, status: 'failed', steps_snapshot: steps } })
  }

  if (nextIdx >= steps.length) {
    await db.update(pipelineRuns).set({ status: 'completed', current_step: currentIdx, steps_snapshot: JSON.stringify(steps), completed_at: now }).where(eq(pipelineRuns.id, runId))
    eventBus.broadcast('activity.created', { type: 'pipeline_completed', entity_type: 'pipeline', entity_id: run.pipeline_id, description: `Pipeline run #${runId} completed` })
    return NextResponse.json({ run: { id: runId, status: 'completed', steps_snapshot: steps } })
  }

  steps[nextIdx].status = 'running'
  steps[nextIdx].started_at = now

  const templateRows = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, steps[nextIdx].template_id)).limit(1)
  const template = templateRows[0]

  let spawnResult: any = null
  if (template) {
    const pipelineRows = await db.select({ name: workflowPipelines.name }).from(workflowPipelines).where(eq(workflowPipelines.id, run.pipeline_id)).limit(1)
    spawnResult = await spawnStep(pipelineRows[0]?.name || '?', template, steps, nextIdx, runId)
  }

  await db.update(pipelineRuns).set({ current_step: nextIdx, steps_snapshot: JSON.stringify(steps) }).where(eq(pipelineRuns.id, runId))

  return NextResponse.json({ run: { id: runId, status: 'running', current_step: nextIdx, steps_snapshot: steps, spawn: spawnResult } })
}

async function cancelRun(runId: number) {
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 })

  const runRows = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1)
  const run = runRows[0]
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status !== 'running' && run.status !== 'pending') {
    return NextResponse.json({ error: `Run is ${run.status}, cannot cancel` }, { status: 400 })
  }

  const steps: RunStepState[] = JSON.parse(run.steps_snapshot)
  const now = Math.floor(Date.now() / 1000)

  for (const step of steps) {
    if (step.status === 'pending' || step.status === 'running') {
      step.status = 'skipped'
      step.completed_at = now
    }
  }

  await db.update(pipelineRuns).set({ status: 'cancelled', steps_snapshot: JSON.stringify(steps), completed_at: now }).where(eq(pipelineRuns.id, runId))

  return NextResponse.json({ run: { id: runId, status: 'cancelled', steps_snapshot: steps } })
}
