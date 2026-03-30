'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TaskList } from './task-list'
import { ProjectFilterBar, useProjectFilters } from './project-filter-bar'
import { TaskQueue } from './task-queue'
import { TaskPromptInput } from './task-prompt-input'
import { useTaskKeyboard, type TaskViewSection } from './use-task-keyboard'
import { useViewMode } from './view-toggle'
import { AnimatedModal } from '@/components/ui/animated-modal'
import { useSmartPoll } from '@/lib/use-smart-poll'
import type { Task } from '@/store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agent {
  id: number
  name: string
  role: string
}

// ---------------------------------------------------------------------------
// Agent names that get tasks routed to queue instead of "My Tasks"
// ---------------------------------------------------------------------------

const AGENT_NAMES = new Set([
  'cseno', 'main', 'cody', 'ralph', 'dumbo', 'piem',
  'worm', 'scottie', 'pinball', 'uze', 'roach', 'rover', 'auwl',
])

function isAgentTask(task: Task): boolean {
  return AGENT_NAMES.has((task.assigned_to || '').toLowerCase())
}

// ---------------------------------------------------------------------------
// TaskViewPanel
// ---------------------------------------------------------------------------

export function TaskViewPanel() {
  // ---- Data state
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---- P2: project filter + view mode
  const { projects, refetch: refetchProjects } = useProjectFilters()
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useViewMode('default')

  // ---- P5: keyboard nav state
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [activeTaskId, setActiveTaskId] = useState<string | number | null>(null)
  const [activeSection, setActiveSection] = useState<TaskViewSection>('task-list')
  const [modalTaskId, setModalTaskId] = useState<string | number | null>(null)

  // ---- Section refs for Tab cycling (P5)
  const filterBarRef = useRef<HTMLDivElement | null>(null)
  const taskListRef = useRef<HTMLDivElement | null>(null)
  const queueRef = useRef<HTMLDivElement | null>(null)
  const promptRef = useRef<HTMLDivElement | null>(null)

  // ---- Derived task lists
  const myTasks = allTasks.filter((t) => {
    const assignee = (t.assigned_to || '').toLowerCase()
    if (isAgentTask(t)) return false
    if (t.status === 'closed') return false
    if (activeProjectId && t.project_id !== activeProjectId) return false
    return true
  })

  const queueTasks = allTasks.filter((t) => {
    if (!isAgentTask(t)) return false
    if (t.status === 'closed') return false
    if (activeProjectId && t.project_id !== activeProjectId) return false
    return true
  })

  // ---- Fetch tasks + agents
  const fetchData = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true)
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/agents?limit=50'),
      ])
      if (!tasksRes.ok) throw new Error('Failed to fetch tasks')

      const tasksData = await tasksRes.json()
      const agentsData = agentsRes.ok ? await agentsRes.json() : { agents: [] }

      setAllTasks(tasksData.tasks || tasksData || [])
      setAgents(agentsData.agents || [])
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // 30s smart poll
  useSmartPoll(() => fetchData(true), 30000)

  // ---- P5: keyboard navigation
  useTaskKeyboard({
    itemCount: myTasks.length,
    focusedIndex,
    setFocusedIndex,
    onEnter: (i) => {
      const task = myTasks[i]
      if (task) { setActiveTaskId(task.id); setModalTaskId(task.id) }
    },
    onSpace: (i) => {
      const task = myTasks[i]
      if (!task) return
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(task.id)) next.delete(task.id)
        else next.add(task.id)
        return next
      })
    },
    onEscape: () => {
      setModalTaskId(null)
      setActiveTaskId(null)
      setFocusedIndex(-1)
    },
    onSlash: () => {
      if (promptRef.current) {
        const ta = promptRef.current.querySelector<HTMLElement>('textarea')
        ta?.focus()
      }
    },
    isModalOpen: modalTaskId !== null,
    filterBarRef,
    taskListRef,
    queueRef,
    promptRef,
    activeSection,
    onSectionChange: setActiveSection,
  })

  // ---- Refresh callback after task creation
  const handleTaskCreated = useCallback(() => {
    fetchData(true)
    refetchProjects()
  }, [fetchData, refetchProjects])

  // ---- Loading / error states
  if (loading && allTasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading tasks...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>

      {/* Top: ProjectFilterBar (P2) */}
      <div ref={filterBarRef}>
        <ProjectFilterBar
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Task List (P1) — Cri's tasks */}
        <div ref={taskListRef} style={{ flex: 1, overflow: 'hidden' }}>
          <TaskList
            tasks={myTasks}
            focusedIndex={focusedIndex}
            selectedIds={selectedIds}
            activeId={activeTaskId}
            compressed={viewMode === 'compressed'}
            onToggle={(id) => {
              setSelectedIds((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }}
            onClickTask={(id) => {
              setActiveTaskId((prev) => prev === id ? null : id)
              setModalTaskId(id)
            }}
          />
        </div>

        {/* Bottom panel: Queue + Prompt */}
        <div className="border-t border-border flex-shrink-0">

          {/* P3: Agent Queue */}
          <div ref={queueRef}>
            <TaskQueue
              tasks={queueTasks}
              onClickTask={(id) => setModalTaskId(id)}
              defaultOpen={queueTasks.length > 0}
            />
          </div>

          {/* P4: Prompt Input */}
          <div ref={promptRef}>
            <TaskPromptInput
              activeProjectId={activeProjectId}
              projects={projects.map((p) => ({
                id: p.id || '',
                title: p.title,
              }))}
              agents={agents.map((a) => ({
                id: String(a.id),
                name: a.name,
                role: a.role,
              }))}
              onCreated={handleTaskCreated}
            />
          </div>
        </div>
      </div>

      {/* Task Detail Modal */}
      {modalTaskId !== null && (
        <AnimatedModal open={true} onClose={() => setModalTaskId(null)}>
          <div className="flex flex-col" style={{ minHeight: '50vh', maxHeight: '85vh' }}>
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-foreground">Task Detail</h3>
              <button
                onClick={() => setModalTaskId(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
                  <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {(() => {
                const task = allTasks.find((t) => t.id === modalTaskId)
                if (!task) return <p className="text-sm text-muted-foreground">Task not found</p>
                return (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-foreground">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{task.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Status: <b className="text-foreground">{task.status}</b></span>
                      <span>Priority: <b className="text-foreground">{task.priority}</b></span>
                      {task.assigned_to && <span>Assigned: <b className="text-foreground">{task.assigned_to}</b></span>}
                      {task.project_title && <span>Project: <b className="text-foreground">{task.project_title}</b></span>}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </AnimatedModal>
      )}
    </div>
  )
}
