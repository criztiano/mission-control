import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { runOpenClaw, runOpenClawDetached } from '@/lib/command'
import { getIssue, getTurns, setTaskPicked } from '@/lib/cc-db'
import { db } from '@/db/client'
import { issues, dispatchQueue, issueDependencies } from '@/db/schema'
import { eq, and, ne, sql, desc, inArray } from 'drizzle-orm'
import { logger } from '@/lib/logger'

type DispatchParams = {
  taskId: string
  title: string
  assignee?: string
  reason: 'create' | 'reassign'
  content?: string
}

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
const DISPATCH_TIMEOUT_MS = 5 * 60 * 1000 // 5 min to post a turn or we auto-retry
const MAX_RETRIES = 3
const DEDUP_WINDOW_MS = 60_000 // ignore duplicate dispatch for same task+agent within 60s

// Derive dispatch URL from explicit env or fall back to gateway env vars.
// On Vercel: set DISPATCH_URL=https://<tailscale-funnel>/hooks/agent
// On local: falls back to the local gateway automatically.
function getDispatchUrl(): string | null {
  if (process.env.DISPATCH_URL) return process.env.DISPATCH_URL
  // Fall back to gateway env vars (works locally, and on Vercel if DISPATCH_URL is set correctly)
  const host = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'
  const port = process.env.OPENCLAW_GATEWAY_PORT || '18789'
  if (IS_SERVERLESS) {
    // On serverless without explicit DISPATCH_URL, we can't reach local gateway
    return null
  }
  return `http://${host}:${port}/hooks/agent`
}

function getDispatchToken(): string {
  return process.env.DISPATCH_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || ''
}

// In-memory timers (local only — die on Vercel)
const retryTimers = new Map<string, NodeJS.Timeout>()
const dispatchWatchdogs = new Map<string, NodeJS.Timeout>()
const dispatchRetryCount = new Map<string, number>()

// Known agent IDs that can receive dispatches.
// Human assignees (cri, etc.) are NOT agents and should not be dispatched to.
const KNOWN_AGENTS = new Set([
  'main', 'cseno', 'cody', 'worm', 'ops', 'piem', 'ralph', 'pinball', 'uze', 'dumbo',
])

// Agents that use spawn (no persistent main session)
const SPAWN_AGENTS = new Set(['dumbo', 'uze', 'ralph', 'piem', 'cody'])

function resolveAgentId(assignee: string): string | null {
  const a = (assignee || '').trim().toLowerCase()
  if (!a) return null
  if (!KNOWN_AGENTS.has(a)) return null  // human assignee — skip
  if (a === 'cseno') return 'main'
  return a
}

/** Check if an assignee name maps to a known agent (for UI purposes) */
export function isAgentAssignee(assignee: string): boolean {
  return resolveAgentId(assignee) !== null
}

/**
 * Check if all dependencies of a task are closed.
 * Returns true if the task has NO unresolved dependencies (i.e. safe to dispatch).
 */
async function areDependenciesMet(taskId: string): Promise<boolean> {
  // Check the issue_dependencies table
  const deps = await db
    .select({ depends_on: issueDependencies.depends_on })
    .from(issueDependencies)
    .where(eq(issueDependencies.issue_id, taskId))

  if (deps.length === 0) return true // no dependencies

  // Check if all depended-on tasks are closed
  const depIds = deps.map(d => d.depends_on)
  const openBlockers = await db
    .select({ id: issues.id, status: issues.status })
    .from(issues)
    .where(and(
      inArray(issues.id, depIds),
      ne(issues.status, 'closed')
    ))
    .limit(1)

  if (openBlockers.length > 0) {
    logger.info({ taskId, blockedBy: openBlockers[0].id }, 'Task blocked by open dependency')
    return false
  }

  return true
}

/**
 * When a task is closed, find any tasks that depend on it and
 * dispatch them if all their dependencies are now met.
 */
export async function cascadeDispatchOnClose(closedTaskId: string) {
  // Find tasks that depend on the just-closed task
  const dependents = await db
    .select({ issue_id: issueDependencies.issue_id })
    .from(issueDependencies)
    .where(eq(issueDependencies.depends_on, closedTaskId))

  if (dependents.length === 0) return

  logger.info({ closedTaskId, dependentCount: dependents.length }, 'Checking dependents after task close')

  for (const dep of dependents) {
    const task = await getIssue(dep.issue_id)
    if (!task || task.status !== 'open' || !task.assignee) continue

    // Check if ALL dependencies are now met (not just this one)
    const ready = await areDependenciesMet(dep.issue_id)
    if (!ready) continue

    logger.info({ taskId: dep.issue_id, assignee: task.assignee }, 'Dependency met — dispatching unblocked task')

    void dispatchTaskNudge({
      taskId: dep.issue_id,
      title: task.title,
      assignee: task.assignee,
      reason: 'create',
      content: task.description || undefined,
    }).catch(e => {
      logger.warn({ err: e, taskId: dep.issue_id }, 'Failed to dispatch unblocked task')
    })
  }
}

function withOpenClawEnv() {
  return {
    ...process.env,
    OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH || `${process.env.HOME}/.openclaw/openclaw.json`,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR || `${process.env.HOME}/.openclaw`,
  }
}

// ─── DB-based dispatch queue (replaces filesystem pending/watchdog) ───

async function enqueuePending(agentId: string, payload: DispatchParams) {
  try {
    // Upsert: one pending entry per task+agent (dedup)
    const existing = await db.select({ id: dispatchQueue.id })
      .from(dispatchQueue)
      .where(and(
        eq(dispatchQueue.task_id, payload.taskId),
        eq(dispatchQueue.agent_id, agentId),
        eq(dispatchQueue.status, 'pending'),
      ))
      .limit(1)

    if (existing.length > 0) {
      // Already queued — skip
      return
    }

    await db.insert(dispatchQueue).values({
      id: randomUUID(),
      task_id: payload.taskId,
      agent_id: agentId,
      status: 'pending',
      turn_count_at_dispatch: 0,
      retry_count: 0,
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    logger.warn({ err: e, taskId: payload.taskId, agentId }, 'Failed to enqueue pending dispatch')
  }
}

async function popPending(agentId: string): Promise<DispatchParams[]> {
  try {
    const rows = await db.select()
      .from(dispatchQueue)
      .where(and(
        eq(dispatchQueue.agent_id, agentId),
        eq(dispatchQueue.status, 'pending'),
      ))

    if (rows.length === 0) return []

    // Delete them
    const ids = rows.map(r => r.id)
    for (const id of ids) {
      await db.delete(dispatchQueue).where(eq(dispatchQueue.id, id))
    }

    return rows.map(r => ({
      taskId: r.task_id,
      title: '',
      assignee: r.agent_id,
      reason: 'reassign' as const,
    }))
  } catch (e) {
    logger.warn({ err: e, agentId }, 'Failed to pop pending dispatches')
    return []
  }
}

async function recordDispatch(taskId: string, agentId: string, turnCount: number) {
  try {
    const now = new Date().toISOString()
    // Upsert: update if exists for this task+agent, otherwise insert
    const existing = await db.select({ id: dispatchQueue.id })
      .from(dispatchQueue)
      .where(and(
        eq(dispatchQueue.task_id, taskId),
        eq(dispatchQueue.agent_id, agentId),
        sql`${dispatchQueue.status} IN ('dispatched', 'pending')`,
      ))
      .limit(1)

    if (existing.length > 0) {
      await db.update(dispatchQueue)
        .set({ status: 'dispatched', dispatched_at: now, turn_count_at_dispatch: turnCount })
        .where(eq(dispatchQueue.id, existing[0].id))
    } else {
      await db.insert(dispatchQueue).values({
        id: randomUUID(),
        task_id: taskId,
        agent_id: agentId,
        status: 'dispatched',
        turn_count_at_dispatch: turnCount,
        dispatched_at: now,
        created_at: now,
      })
    }
  } catch (e) {
    logger.warn({ err: e, taskId, agentId }, 'Failed to record dispatch')
  }
}

/** Check if this task+agent was dispatched very recently (dedup guard) */
async function wasRecentlyDispatched(taskId: string, agentId: string): Promise<boolean> {
  try {
    const rows = await db.select({ dispatched_at: dispatchQueue.dispatched_at })
      .from(dispatchQueue)
      .where(and(
        eq(dispatchQueue.task_id, taskId),
        eq(dispatchQueue.agent_id, agentId),
        eq(dispatchQueue.status, 'dispatched'),
      ))
      .orderBy(desc(dispatchQueue.dispatched_at))
      .limit(1)

    if (rows.length === 0) return false
    const dispatchedAt = rows[0].dispatched_at
    if (!dispatchedAt) return false
    const age = Date.now() - new Date(dispatchedAt).getTime()
    return age < DEDUP_WINDOW_MS
  } catch {
    return false
  }
}

/** Mark dispatch as completed (called when agent posts a turn) */
export async function markDispatchCompleted(taskId: string, agentId: string) {
  try {
    await db.update(dispatchQueue)
      .set({ status: 'completed', completed_at: new Date().toISOString() })
      .where(and(
        eq(dispatchQueue.task_id, taskId),
        eq(dispatchQueue.agent_id, agentId),
        eq(dispatchQueue.status, 'dispatched'),
      ))
  } catch (e) {
    logger.warn({ err: e, taskId, agentId }, 'Failed to mark dispatch completed')
  }
}

// ─── Watchdog (works on both local and Vercel) ───

function scheduleDispatchWatchdog(taskId: string, agentId: string, turnCountAtDispatch: number) {
  if (IS_SERVERLESS) return  // timers don't survive serverless invocations

  const key = `${taskId}:${agentId}`

  // Clear any existing watchdog for this task
  if (dispatchWatchdogs.has(key)) {
    clearTimeout(dispatchWatchdogs.get(key)!)
  }

  const timer = setTimeout(async () => {
    dispatchWatchdogs.delete(key)
    try {
      // Check if agent posted a turn since dispatch
      const currentTurns = await getTurns(taskId)
      if (currentTurns.length > turnCountAtDispatch) {
        logger.info({ taskId, agentId }, 'dispatch-watchdog: agent posted turn — healthy')
        dispatchRetryCount.delete(key)
        await markDispatchCompleted(taskId, agentId)
        return
      }

      // No turn yet — check if agent is still actively working
      const agentIsActive = await isSessionActive(agentId)
      if (agentIsActive) {
        logger.info({ taskId, agentId }, 'dispatch-watchdog: agent session active — rescheduling check')
        scheduleDispatchWatchdog(taskId, agentId, turnCountAtDispatch)
        return
      }

      // No turn AND no active session — agent is dead
      const retries = dispatchRetryCount.get(key) || 0
      if (retries >= MAX_RETRIES) {
        logger.warn({ taskId, agentId, retries }, 'dispatch-watchdog: max retries reached — resetting picked')
        dispatchRetryCount.delete(key)
        // Reset picked so periodic scan can re-dispatch
        await db.update(issues).set({ picked: false, picked_at: null }).where(eq(issues.id, taskId))
        await db.update(dispatchQueue)
          .set({ status: 'failed' })
          .where(and(eq(dispatchQueue.task_id, taskId), eq(dispatchQueue.agent_id, agentId), eq(dispatchQueue.status, 'dispatched')))
        return
      }

      logger.warn({ taskId, agentId, retries: retries + 1 }, 'dispatch-watchdog: no turn after 5min — auto-retrying')
      dispatchRetryCount.set(key, retries + 1)

      // Increment retry count in DB
      await db.update(dispatchQueue)
        .set({ retry_count: retries + 1 })
        .where(and(eq(dispatchQueue.task_id, taskId), eq(dispatchQueue.agent_id, agentId), eq(dispatchQueue.status, 'dispatched')))

      // Re-dispatch
      await dispatchTaskNudge({
        taskId,
        title: '',
        assignee: agentId,
        reason: 'reassign',
      })
    } catch (e) {
      logger.error({ err: e, taskId, agentId }, 'dispatch-watchdog: retry failed')
    }
  }, DISPATCH_TIMEOUT_MS)

  dispatchWatchdogs.set(key, timer)
}

/** Check if an agent has an active session (updated in last 5 min) */
async function isSessionActive(agentId: string): Promise<boolean> {
  if (IS_SERVERLESS) return false  // can't check local sessions from Vercel
  try {
    const out = await runOpenClaw(['sessions', '--agent', agentId, '--json'], {
      timeoutMs: 8000,
      env: withOpenClawEnv(),
    })
    const parsed = JSON.parse(out.stdout || '{}')
    const sessions = parsed?.sessions || []
    if (sessions.length === 0) return false
    const now = Date.now()
    return sessions.some((s: any) => {
      const updatedAt = Number(s.updatedAt || 0)
      return updatedAt > 0 && (now - updatedAt) < 5 * 60 * 1000
    })
  } catch {
    return false
  }
}

async function isLikelyBusy(assignee: string): Promise<boolean> {
  if (IS_SERVERLESS) return false  // can't check local sessions from Vercel
  // Spawn agents always get fresh sessions — never considered busy
  const a = assignee.toLowerCase()
  if (SPAWN_AGENTS.has(a)) return false
  // Only guard persistent-session agents that might be mid-conversation
  if (a !== 'cody') return false

  try {
    const out = await runOpenClaw(['sessions', '--agent', a, '--json'], {
      timeoutMs: 8000,
      env: withOpenClawEnv(),
    })
    const parsed = JSON.parse(out.stdout || '{}')
    const sessions = parsed?.sessions || []
    const row = sessions.find((s: any) => s?.key === `agent:${a}:main`) || sessions[0]
    if (!row) return false
    const updatedAt = Number(row.updatedAt || 0)
    if (!updatedAt) return false
    return (Date.now() - updatedAt) < 5 * 60 * 1000
  } catch {
    // if uncertain, assume not busy (don't block dispatch forever)
    return false
  }
}

// ─── Core dispatch logic ───

async function sendOne(payload: DispatchParams) {
  const assignee = (payload.assignee || '').trim()
  const agentId = resolveAgentId(assignee)
  if (!agentId) return { sent: false as const, reason: 'no-agent' as const }

  // Dependency guard: skip if task has unmet dependencies
  if (!(await areDependenciesMet(payload.taskId))) {
    logger.info({ taskId: payload.taskId, agentId }, 'Skipping dispatch — blocked by dependencies')
    return { sent: false as const, reason: 'blocked' as const }
  }

  // Dedup guard: skip if same task+agent was dispatched in last 60s
  if (await wasRecentlyDispatched(payload.taskId, agentId)) {
    logger.info({ taskId: payload.taskId, agentId }, 'Skipping dispatch — dedup (dispatched <60s ago)')
    return { sent: false as const, reason: 'dedup' as const }
  }

  const compactContext = (payload.content || '').replace(/\s+/g, ' ').trim().slice(0, 240)

  if (SPAWN_AGENTS.has(agentId)) {
    // Check if agent already has a picked task (busy) — queue drain will handle it later
    // Query both the original assignee name AND the resolved agentId since DB might store either
    const { projects } = await import('@/db/schema')
    const busyRows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(sql`(LOWER(${issues.assignee}) = LOWER(${assignee}) OR LOWER(${issues.assignee}) = LOWER(${agentId})) AND ${issues.status} = 'open' AND ${issues.picked} = true AND ${issues.id} != ${payload.taskId}`)
      .limit(1)
    if (busyRows.length > 0) {
      return { sent: false as const, reason: 'agent-busy' as const }
    }

    // Fetch full task data, mark as picked, and embed everything in the message.
    const issue = await getIssue(payload.taskId)
    if (!issue) {
      return { sent: false as const, reason: 'no-task' as const }
    }

    // Dedup guard #2: if task is already picked by this agent, skip
    if (issue.picked && issue.picked_by?.toLowerCase() === agentId) {
      logger.info({ taskId: payload.taskId, agentId }, 'Skipping dispatch — task already picked by this agent')
      return { sent: false as const, reason: 'already-picked' as const }
    }

    // Mark task as picked — wrap so failures are surfaced not swallowed
    try {
      await setTaskPicked(payload.taskId, agentId)
    } catch (pickErr) {
      logger.error({ err: pickErr, taskId: payload.taskId, agentId }, 'setTaskPicked failed')
      return { sent: false as const, reason: 'pick-failed' as const }
    }

    const turns = await getTurns(payload.taskId)

    const turnsBlock = turns.length > 0
      ? `## Prior turns\n\n${turns.map(t => `**[${t.type}] ${t.author}** (round ${t.round_number}):\n${t.content}`).join('\n\n---\n\n')}`
      : ''

    // Resolve project local path from the projects table
    let projectPath = ''
    if (issue.project_id) {
      const projRows = await db.select({ title: projects.title, local_path: projects.local_path }).from(projects).where(eq(projects.id, issue.project_id!)).limit(1)
      const proj = projRows[0]
      const localPath = proj?.local_path?.replace('~', process.env.HOME || '~')
      projectPath = `\n**Project:** ${proj?.title || issue.project_id}${localPath ? `\n**Project path:** \`${localPath}\` — cd here and work in this directory` : ''}`
    }

    // Team config — single source of truth for PM↔Builder routing
    const TEAMS: Record<string, { pm: string; builder: string }> = {
      skunkworks: { pm: 'ralph', builder: 'dumbo' },
      main:       { pm: 'piem',  builder: 'cody' },
    }
    const team = Object.values(TEAMS).find(t => t.pm === agentId || t.builder === agentId)
    const isPM = team ? team.pm === agentId : false
    const builderTarget = team?.builder || 'cody'
    const pmTarget = team?.pm || 'cri'
    // Builders report to their PM, PMs report to Cri, non-team agents report to Cri
    const resultTarget = team
      ? (isPM ? 'cri' : pmTarget)   // PM→cri, builder→pm
      : 'cri'

    // Skunkworks PMs delegate directly; Main Crew PMs send plan to Cri for approval
    const isAutonomous = team && (team.pm === 'ralph') // only skunkworks is autonomous
    const planTarget = isAutonomous ? builderTarget : 'cri'
    const planNote = isAutonomous
      ? `Delegate to ${builderTarget}`
      : `Send to Cri for approval (Main Crew policy)`

    const approvalBlock = !isAutonomous ? `

### If Cri APPROVED your plan (turn from Cri):

**Check your plan: does it have 3+ phases?**

**YES (multi-phase) → Create sub-tasks with dependencies:**

Create one task per phase. Each depends on the previous. Only Phase 1 dispatches immediately — the rest auto-dispatch when their dependency closes.

\`\`\`bash
# Phase 1 (no dependencies — dispatches immediately)
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"title":"Phase 1: ...","description":"<FULL spec for this phase only — files, acceptance criteria, browser test>","assigned_to":"${builderTarget}","parent_id":"${payload.taskId}","depends_on":[],"metadata":{"project_id":"<PROJECT_ID>"}}'

# Phase 2 (depends on Phase 1 — auto-dispatches when P1 closes)
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"title":"Phase 2: ...","description":"<FULL spec for this phase>","assigned_to":"${builderTarget}","parent_id":"${payload.taskId}","depends_on":["<PHASE_1_TASK_ID>"],"metadata":{"project_id":"<PROJECT_ID>"}}'

# Phase 3 depends on Phase 2, etc.
\`\`\`

⚠️ **CRITICAL:** You MUST include \`depends_on\` with the previous phase's task ID. Without it, ALL phases dispatch at once and ${builderTarget} works on them out of order.

After creating all sub-tasks, post a summary turn on the PARENT task:
\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"cri","content":"## 📋 Sub-tasks Created\\n\\nBroke the plan into N phases with dependency chain. Phase 1 dispatched to ${builderTarget}."}'
\`\`\`

**NO (simple task, 1-2 phases) → Direct delegation:**
\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"${builderTarget}","content":"Plan approved by Cri. Implementing."}'
\`\`\`
` : ''

    let workflowBlock: string
    if (isPM) {
      const taskBranchPM = `task/${payload.taskId.slice(0, 8)}`
      workflowBlock = `## Your workflow (PM${isAutonomous ? ' — fully autonomous' : ' — plan needs Cri approval'})

### If this is a NEW task (no prior turns from ${builderTarget}):
1. Read the task and write a proper plan with acceptance criteria
2. Create the plan via Eden Plans API:

\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/plans" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"title":"<plan title>","content":"<full plan markdown>","task_id":"${payload.taskId}","author":"${agentId}"}'
\`\`\`

3. ${planNote} by posting a result turn that **references the plan** (do NOT put the plan content in the turn):

\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"${planTarget}","content":"## 📋 Plan Ready\\n\\nWrote a plan for this task. See the plan link for full spec.","links":[{"url":"https://eden-iota-one.vercel.app/plans/<PLAN_ID>","title":"View Plan","type":"doc"}]}'
\`\`\`

**IMPORTANT:** The turn should be a SHORT summary (2-3 sentences) + a link to the plan. Do NOT paste the entire plan into the turn content.
${approvalBlock}

### If this is a REVIEW (${builderTarget} posted a result turn):

**Step 1: Code review**
\`\`\`bash
cd <project_path>
git fetch origin
git diff main..${taskBranchPM}
\`\`\`

**Step 2: Build check**
\`\`\`bash
npx next build
\`\`\`

**Step 3: Browser testing (MANDATORY — do NOT skip)**
Use \`agent-browser\` to verify the feature works like a real user would:
\`\`\`bash
agent-browser open https://eden-iota-one.vercel.app/<relevant-page>
agent-browser screenshot
agent-browser snapshot -i
\`\`\`
- Navigate to the affected page/panel
- Verify the UI renders correctly (not empty, no errors)
- Check that new features/data are visible
- If you can't verify visually, the review FAILS

**Step 4a: If review PASSES → merge to develop and deliver:**
\`\`\`bash
cd <project_path>
git checkout develop && git pull origin develop
git merge ${taskBranchPM} --no-edit
git push origin develop
\`\`\`

Then post delivery turn:
\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"cri","content":"## ✅ Done\\n\\nReviewed, browser-tested, merged to develop.","links":[{"url":"https://github.com/criztiano/mission-control/compare/main...develop","title":"View Changes","type":"diff"}]}'
\`\`\`

**⚠️ A task is NOT done until code is on \`develop\` and pushed. Never leave it on a task branch.**

**Step 4b: If review FAILS → send back with specific issues:**
\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"${builderTarget}","content":"## ❌ Review Failed\\n\\n**Issues:**\\n\\n1. ...\\n\\n2. ...\\n\\n**Fix these and re-push to the same branch.**"}'
\`\`\``
    } else {
      const taskBranch = `task/${payload.taskId.slice(0, 8)}`
      workflowBlock = `## Git workflow (mandatory)

1. cd into the **project path** (see above) — NEVER work in your home directory
2. Create a feature branch:
\`\`\`bash
git checkout develop && git pull
git checkout -b ${taskBranch}
\`\`\`
3. Implement the changes
4. Commit and push:
\`\`\`bash
git add -A && git commit -m "feat: <short description>"
git push -u origin ${taskBranch}
\`\`\`
5. Run the build to verify — fix any errors before reporting
6. **Self-test with chrome-devtools-mcp (MANDATORY):**
   - Start dev server if needed: \`npx next dev &\`
   - Use MCP tools to navigate to the affected page
   - Verify your changes render correctly (not empty, no console errors)
   - If something's broken, fix it before reporting done
   - "Build passes" ≠ "feature works" — you MUST verify visually

## How to report back

When done, post a turn (routes to **${resultTarget}**). Include the branch name and links:

\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"${resultTarget}","content":"## ✅ Done\\n\\n**Branch:** \\\`${taskBranch}\\\`\\n\\n**Changes:**\\n\\n- File1 — what changed\\n\\n- File2 — what changed\\n\\n**Build:** Passing","links":[{"url":"https://github.com/criztiano/mission-control/compare/develop...${taskBranch}","title":"View Diff","type":"diff"}]}'
\`\`\`

If you need clarification:

\`\`\`bash
curl -s -X POST "https://eden-iota-one.vercel.app/api/tasks/${payload.taskId}/turns" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: a2b6f6c96df5eba20ac83e7a4bf538adf7ea37701177c7eb430519986d4dc3a0" \\
  -d '{"assigned_to":"cri","content":"## ❓ Need Clarification\\n\\n1. Question one\\n\\n2. Question two"}'
\`\`\``
    }

    const nudgeMsg = `# Task Assignment

**Task ID:** ${payload.taskId}
**Priority:** ${issue.priority}${projectPath}

## Description (this is the spec — follow this, not the title)

${issue.description || '(no description)'}

${turnsBlock}

${workflowBlock}

**Critical rules:**
- Work on THIS task (${payload.taskId}) — do NOT create new tasks.
- Never change task status — only post turns.
- After posting your turn, reply NO_REPLY to close your session.

**Formatting rules for turn content (ADHD-friendly, must follow):**
- Use **## headers** with emoji (✅ Done, ❌ Failed, ❓ Questions)
- One blank line between every section and every bullet point
- **Bold** key terms — file names, branch names, status words
- Keep bullets short — one line each, no walls of text
- Use the **links** array in the JSON for any URLs (PRs, diffs, docs) — they render as clickable buttons in the UI. Format: \`"links":[{"url":"...","title":"Label","type":"pr|diff|doc"}]\`
- NEVER paste raw URLs in the content text — always use the links array`

    // Dispatch via webhook (Vercel) or local CLI
    const dispatchUrl = getDispatchUrl()
    const dispatchToken = getDispatchToken()

    if (dispatchUrl) {
      // Webhook path: used on Vercel (DISPATCH_URL env var) and locally via gateway
      logger.info({ agentId, taskId: payload.taskId, dispatchUrl }, 'Dispatching via webhook')
      try {
        const resp = await fetch(dispatchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(dispatchToken ? { 'Authorization': `Bearer ${dispatchToken}` } : {}),
          },
          body: JSON.stringify({ agentId, message: nudgeMsg }),
        })
        if (!resp.ok) {
          const body = await resp.text().catch(() => '')
          logger.error({ agentId, taskId: payload.taskId, status: resp.status, body }, 'Dispatch webhook failed — task picked but not delivered')
          // Unmark picked so the task can be retried
          await db.update(issues).set({ picked: false, picked_at: null, picked_by: null }).where(eq(issues.id, payload.taskId)).catch(() => {})
          return { sent: false as const, reason: 'webhook-error' as const }
        }
        logger.info({ agentId, taskId: payload.taskId }, 'Dispatch webhook succeeded')
      } catch (e) {
        logger.error({ err: e, agentId, taskId: payload.taskId }, 'Dispatch webhook fetch error — task picked but not delivered')
        await db.update(issues).set({ picked: false, picked_at: null, picked_by: null }).where(eq(issues.id, payload.taskId)).catch(() => {})
        return { sent: false as const, reason: 'webhook-error' as const }
      }
    } else if (IS_SERVERLESS) {
      // Serverless with no DISPATCH_URL configured — can't deliver, unmark picked
      logger.error({ agentId, taskId: payload.taskId }, 'Dispatch skipped: running serverless but DISPATCH_URL is not configured. Set DISPATCH_URL=https://<gateway-funnel>/hooks/agent on Vercel.')
      await db.update(issues).set({ picked: false, picked_at: null, picked_by: null }).where(eq(issues.id, payload.taskId)).catch(() => {})
      return { sent: false as const, reason: 'no-dispatch-url' as const }
    } else {
      // Running locally — use CLI directly
      // Force truly fresh session: cleanup gateway memory + delete session files
      const sessDir = `${process.env.HOME}/.openclaw/agents/${agentId}/sessions`
      try {
        execSync(`openclaw sessions cleanup --agent ${agentId} --enforce`, {
          timeout: 5000, stdio: 'ignore', env: withOpenClawEnv() as any,
        })
      } catch { /* best-effort */ }
      try {
        for (const f of readdirSync(sessDir)) {
          if (f.endsWith('.jsonl') || f.endsWith('.lock') || f === 'sessions.json') {
            unlinkSync(`${sessDir}/${f}`)
          }
        }
      } catch { /* dir may not exist yet */ }

      runOpenClawDetached([
        'agent',
        '--agent', agentId,
        '--message', nudgeMsg,
      ], {
        env: withOpenClawEnv(),
      })

      // Schedule inline watchdog (local only — timers die on Vercel)
      scheduleDispatchWatchdog(payload.taskId, agentId, turns.length)
    }

    // Record dispatch in DB (works on both local and Vercel)
    await recordDispatch(payload.taskId, agentId, turns.length)

  } else {
    // For persistent agents (main/cseno), skip CLI dispatch entirely.
    // Main agent checks tasks via heartbeats and direct messages.
    logger.info({ agentId, taskId: payload.taskId }, 'Persistent agent — task marked, skipping CLI dispatch (checked via heartbeat)')
    await db.update(issues).set({ picked: true, picked_at: new Date().toISOString(), picked_by: agentId }).where(eq(issues.id, payload.taskId))
  }

  return { sent: true as const, agentId }
}

function scheduleDrain(assignee: string) {
  if (IS_SERVERLESS) return  // timers don't survive serverless invocations
  const key = assignee.toLowerCase()
  if (retryTimers.has(key)) return

  const t = setTimeout(async () => {
    retryTimers.delete(key)
    try {
      if (await isLikelyBusy(key)) {
        scheduleDrain(key)
        return
      }
      const queued = await popPending(key)
      for (const item of queued) {
        await sendOne(item)
      }
    } catch {
      scheduleDrain(key)
    }
  }, 60_000)

  retryTimers.set(key, t)
}

export async function dispatchTaskNudge(params: DispatchParams) {
  const assignee = (params.assignee || '').trim()
  if (!assignee) return { sent: false, reason: 'no-assignee' as const }

  const agentId = resolveAgentId(assignee)

  if (await isLikelyBusy(assignee)) {
    if (agentId) await enqueuePending(agentId, params)
    scheduleDrain(assignee)
    return { sent: false, reason: 'busy-queued' as const }
  }

  // Drain any previous queued nudges first, then send the current one
  if (agentId) {
    const queued = await popPending(agentId)
    for (const item of queued) {
      await sendOne(item)
    }
  }

  return sendOne(params)
}
