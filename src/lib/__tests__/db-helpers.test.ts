import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Drizzle db client
const { mockInsert, mockUpdate, mockSelect, mockBroadcast } = vi.hoisted(() => {
  const mockBroadcast = vi.fn()
  const mockInsertResult = [{ id: 1 }]
  const mockInsert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(mockInsertResult)),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    })),
  }))
  const mockUpdate = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  }))
  const mockSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([{ id: 42 }])),
        orderBy: vi.fn(() => Promise.resolve([])),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([])),
      })),
    })),
  }))
  return { mockInsert, mockUpdate, mockSelect, mockBroadcast }
})

vi.mock('@/db/client', () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: mockBroadcast, on: vi.fn(), emit: vi.fn(), setMaxListeners: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
}))

vi.mock('@/lib/migrations', () => ({
  runMigrations: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/cc-db', () => ({
  runCCMigrations: vi.fn(),
}))

// Import after mocks
import { db_helpers } from '@/lib/db'

describe('parseMentions', () => {
  it('extracts multiple mentions', () => {
    expect(db_helpers.parseMentions('@alice hello @bob')).toEqual(['alice', 'bob'])
  })

  it('returns empty array when no mentions', () => {
    expect(db_helpers.parseMentions('no mentions here')).toEqual([])
  })

  it('extracts single mention', () => {
    expect(db_helpers.parseMentions('hey @alice')).toEqual(['alice'])
  })

  it('handles @@double — captures word chars after @', () => {
    const result = db_helpers.parseMentions('@@double')
    expect(result).toContain('double')
  })

  it('handles mentions at start and end of string', () => {
    expect(db_helpers.parseMentions('@start and @end')).toEqual(['start', 'end'])
  })

  it('returns empty array for empty string', () => {
    expect(db_helpers.parseMentions('')).toEqual([])
  })
})

describe('logActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts activity into database and broadcasts event', async () => {
    await db_helpers.logActivity('task_created', 'task', 1, 'alice', 'Created task')

    expect(mockInsert).toHaveBeenCalled()
    expect(mockBroadcast).toHaveBeenCalledWith(
      'activity.created',
      expect.objectContaining({
        type: 'task_created',
        entity_type: 'task',
        entity_id: 1,
        actor: 'alice',
      }),
    )
  })

  it('stringifies data when provided', async () => {
    const data = { key: 'value' }
    await db_helpers.logActivity('update', 'agent', 2, 'bob', 'Updated agent', data)
    expect(mockInsert).toHaveBeenCalled()
  })
})

describe('createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts notification and broadcasts event', async () => {
    await db_helpers.createNotification('alice', 'mention', 'Mentioned', 'You were mentioned')

    expect(mockInsert).toHaveBeenCalled()
    expect(mockBroadcast).toHaveBeenCalledWith(
      'notification.created',
      expect.objectContaining({
        recipient: 'alice',
        type: 'mention',
        title: 'Mentioned',
      }),
    )
  })

  it('passes source_type and source_id when provided', async () => {
    await db_helpers.createNotification('bob', 'alert', 'Alert', 'CPU high', 'agent', 5)
    expect(mockInsert).toHaveBeenCalled()
  })
})

describe('updateAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset select mock to return an agent
    mockSelect.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ id: 42 }])),
        })),
      })),
    })
  })

  it('updates agent status in database and broadcasts', async () => {
    await db_helpers.updateAgentStatus('worker-1', 'busy', 'Processing task')

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockBroadcast).toHaveBeenCalledWith(
      'agent.status_changed',
      expect.objectContaining({
        id: 42,
        name: 'worker-1',
        status: 'busy',
      }),
    )
  })
})
