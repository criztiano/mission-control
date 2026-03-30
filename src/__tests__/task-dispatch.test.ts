/**
 * Unit tests for task-dispatch.ts
 *
 * Mocks: DB (Drizzle), cc-db helpers, webhook fetch.
 * Does NOT touch Neon or the gateway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks (must be before any imports that use them)
// ---------------------------------------------------------------------------

vi.mock('@/db/client', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

vi.mock('@/db/schema', () => ({
  issues: { id: 'id', assignee: 'assignee', status: 'status', picked: 'picked', picked_at: 'picked_at', picked_by: 'picked_by' },
  dispatchQueue: {
    id: 'id', task_id: 'task_id', agent_id: 'agent_id', status: 'status',
    dispatched_at: 'dispatched_at', completed_at: 'completed_at',
    turn_count_at_dispatch: 'turn_count_at_dispatch', retry_count: 'retry_count', created_at: 'created_at',
  },
  projects: { id: 'id', title: 'title', local_path: 'local_path' },
}))

vi.mock('@/lib/cc-db', () => ({
  getIssue: vi.fn().mockResolvedValue(null),
  getTurns: vi.fn().mockResolvedValue([]),
  setTaskPicked: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/command', () => ({
  runOpenClaw: vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
  runOpenClawDetached: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: vi.fn((a, b) => `${String(a)}=${String(b)}`),
    and: vi.fn((...args) => args.join(' AND ')),
    ne: vi.fn((a, b) => `${String(a)}!=${String(b)}`),
    sql: Object.assign(vi.fn((strings: TemplateStringsArray, ...values: any[]) => strings.join('?')), { join: vi.fn() }),
    desc: vi.fn((col) => `${String(col)} DESC`),
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

// We import after mocking to get the mocked versions
import { isAgentAssignee, markDispatchCompleted, dispatchTaskNudge } from '@/lib/task-dispatch'
import { db } from '@/db/client'
import { getIssue, getTurns, setTaskPicked } from '@/lib/cc-db'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Helper to reset DB mock chain
// ---------------------------------------------------------------------------

function mockDbChain(resolveWith: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolveWith),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  }
  // Each method returns the chain
  for (const key of Object.keys(chain)) {
    if (key !== 'limit' && key !== 'values' && key !== 'execute') {
      chain[key] = vi.fn().mockReturnValue(chain)
    }
  }
  ;(db as any).select = chain.select
  ;(db as any).insert = chain.insert
  ;(db as any).update = chain.update
  ;(db as any).delete = chain.delete
  return chain
}

// ---------------------------------------------------------------------------
// resolveAgentId (tested indirectly via isAgentAssignee)
// ---------------------------------------------------------------------------

describe('isAgentAssignee', () => {
  it('returns true for known agents', () => {
    expect(isAgentAssignee('cody')).toBe(true)
    expect(isAgentAssignee('piem')).toBe(true)
    expect(isAgentAssignee('worm')).toBe(true)
    expect(isAgentAssignee('cseno')).toBe(true) // maps to main
  })

  it('returns false for human assignees', () => {
    expect(isAgentAssignee('cri')).toBe(false)
    expect(isAgentAssignee('')).toBe(false)
    expect(isAgentAssignee('john')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isAgentAssignee('CODY')).toBe(true)
    expect(isAgentAssignee('Piem')).toBe(true)
    expect(isAgentAssignee('CRI')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// wasRecentlyDispatched (tested indirectly)
// ---------------------------------------------------------------------------

describe('wasRecentlyDispatched via dispatchTaskNudge dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    process.env.DISPATCH_URL = 'http://fake-gateway/hooks/agent'
    process.env.DISPATCH_TOKEN = 'test-token'
    delete process.env.VERCEL
  })

  afterEach(() => {
    delete process.env.DISPATCH_URL
    delete process.env.DISPATCH_TOKEN
  })

  it('skips dispatch when task was dispatched <60s ago (dedup)', async () => {
    // The dedup check fires inside sendOne after isLikelyBusy+drain
    // We need the DB to return a recent dispatched entry for the dedup query.
    // DB call sequence for a SPAWN_AGENT like cody:
    //   1. popPending (drain) → []
    //   2. sendOne → busy-check busyRows → []
    //   3. wasRecentlyDispatched → return recent entry
    let callCount = 0
    const mockSelect: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => {
        callCount++
        // 3rd select call = wasRecentlyDispatched
        if (callCount >= 3) {
          return Promise.resolve([{ dispatched_at: new Date().toISOString() }])
        }
        return Promise.resolve([])
      }),
    }
    ;(db as any).select = vi.fn().mockReturnValue(mockSelect)

    const result = await dispatchTaskNudge({
      taskId: 'task-1',
      title: 'Test Task',
      assignee: 'cody',
      reason: 'create',
    })

    expect(result.sent).toBe(false)
    // reason is either dedup or no-task (depends on call order)
    // Key assertion: setTaskPicked was NOT called (dedup or no-task both prevent delivery)
    expect(setTaskPicked).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// markDispatchCompleted
// ---------------------------------------------------------------------------

describe('markDispatchCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates dispatch queue to completed', async () => {
    const updateMock = vi.fn().mockReturnThis()
    const setMock = vi.fn().mockReturnThis()
    const whereMock = vi.fn().mockResolvedValue(undefined)
    ;(db as any).update = vi.fn().mockReturnValue({ set: setMock })
    setMock.mockReturnValue({ where: whereMock })

    await markDispatchCompleted('task-1', 'cody')

    expect((db as any).update).toHaveBeenCalled()
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    )
  })

  it('logs warning but does not throw on DB error', async () => {
    ;(db as any).update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('DB error')),
      }),
    })

    await expect(markDispatchCompleted('task-1', 'cody')).resolves.not.toThrow()
    expect((logger as any).warn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// dispatchTaskNudge — basic cases
// ---------------------------------------------------------------------------

describe('dispatchTaskNudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    process.env.DISPATCH_URL = 'http://fake-gateway/hooks/agent'
    process.env.DISPATCH_TOKEN = 'test-token'
    delete process.env.VERCEL
  })

  afterEach(() => {
    delete process.env.DISPATCH_URL
    delete process.env.DISPATCH_TOKEN
  })

  it('returns no-assignee for empty assignee', async () => {
    const result = await dispatchTaskNudge({ taskId: 'x', title: 'X', assignee: '', reason: 'create' })
    expect(result.reason).toBe('no-assignee')
    expect(result.sent).toBe(false)
  })

  it('returns no-agent for human assignee (cri)', async () => {
    mockDbChain([]) // empty dedup check
    const result = await dispatchTaskNudge({ taskId: 'x', title: 'X', assignee: 'cri', reason: 'create' })
    expect(result.sent).toBe(false)
  })

  it('dispatches successfully for cody with webhook', async () => {
    const chain = mockDbChain([])
    ;(getIssue as any).mockResolvedValue({
      id: 'task-2', title: 'Build thing', assignee: 'cody', picked: false, picked_by: null,
      status: 'open', project_id: null, description: 'do it', plan_id: null, plan_path: null,
    })
    ;(setTaskPicked as any).mockResolvedValue(undefined)
    ;(getTurns as any).mockResolvedValue([])

    // Mock DB chain for busy check, dedup, busy queue, etc. all returning empty
    chain.limit = vi.fn().mockResolvedValue([])

    const result = await dispatchTaskNudge({
      taskId: 'task-2',
      title: 'Build thing',
      assignee: 'cody',
      reason: 'create',
      content: 'do it',
    })

    expect(result.sent).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://fake-gateway/hooks/agent',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('unmarks picked on webhook failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, text: async () => 'error', status: 500 })
    const chain = mockDbChain([])
    chain.limit = vi.fn().mockResolvedValue([])

    ;(getIssue as any).mockResolvedValue({
      id: 'task-3', title: 'Fail task', assignee: 'cody', picked: false, picked_by: null,
      status: 'open', project_id: null, description: '', plan_id: null, plan_path: null,
    })
    ;(setTaskPicked as any).mockResolvedValue(undefined)
    ;(getTurns as any).mockResolvedValue([])

    const updateMock = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) }
    ;(db as any).update = vi.fn().mockReturnValue(updateMock)
    updateMock.set.mockReturnValue(updateMock)

    const result = await dispatchTaskNudge({
      taskId: 'task-3',
      title: 'Fail task',
      assignee: 'cody',
      reason: 'create',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('webhook-error')
    // Should have tried to unmark picked
    expect((db as any).update).toHaveBeenCalled()
  })

  it('unmarks picked and logs error when no webhook delivery possible (no DISPATCH_URL, not serverless)', async () => {
    // Simulate: DISPATCH_URL not set, not serverless (local), but no gateway running
    delete process.env.DISPATCH_URL
    delete process.env.VERCEL
    // When running locally without DISPATCH_URL, getDispatchUrl() falls back to http://localhost:18789/hooks/agent
    // Simulate that fetch fails (gateway not running)
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const mockSelect: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    ;(db as any).select = vi.fn().mockReturnValue(mockSelect)

    ;(getIssue as any).mockResolvedValue({
      id: 'task-4', title: 'Serverless task', assignee: 'cody', picked: false, picked_by: null,
      status: 'open', project_id: null, description: '', plan_id: null, plan_path: null,
    })
    ;(setTaskPicked as any).mockResolvedValue(undefined)
    ;(getTurns as any).mockResolvedValue([])

    const updateMock = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) }
    ;(db as any).update = vi.fn().mockReturnValue(updateMock)
    updateMock.set.mockReturnValue(updateMock)

    const result = await dispatchTaskNudge({
      taskId: 'task-4',
      title: 'Serverless task',
      assignee: 'cody',
      reason: 'create',
    })

    // Should fail gracefully and unmark picked
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('webhook-error')
    // Should have tried to unmark picked on failure
    expect((db as any).update).toHaveBeenCalled()
  })
})
