'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Queue,
  QueueSection,
  QueueSectionTrigger,
  QueueSectionLabel,
  QueueSectionContent,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
} from '@/components/ai-elements/queue'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueTask {
  id: string | number
  title: string
  status: string
  assigned_to?: string
  /** picked=1 means actively being worked on */
  picked?: number | boolean
  last_turn_at?: number | null
  last_turn_by?: string | null
}

// Status classification
function taskStatus(t: QueueTask): 'working' | 'queued' {
  if (t.picked) return 'working'
  return 'queued'
}

// ---------------------------------------------------------------------------
// Spinner SVG (for "working" state)
// ---------------------------------------------------------------------------

function SpinnerDot() {
  return (
    <svg
      viewBox="0 0 10 10"
      className="w-2.5 h-2.5 animate-spin"
      fill="none"
    >
      <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 20" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// TaskQueue props
// ---------------------------------------------------------------------------

interface TaskQueueProps {
  /** If provided, tasks are controlled from outside (no internal fetch) */
  tasks?: QueueTask[]
  /** Called when a queue item is clicked */
  onClickTask?: (id: string | number) => void
  /** Default open state */
  defaultOpen?: boolean
  className?: string
}

// ---------------------------------------------------------------------------
// TaskQueue
// ---------------------------------------------------------------------------

export function TaskQueue({ tasks: externalTasks, onClickTask, defaultOpen = false, className }: TaskQueueProps) {
  const [internalTasks, setInternalTasks] = useState<QueueTask[]>([])
  const [loading, setLoading] = useState(!externalTasks)

  const controlled = externalTasks !== undefined
  const tasks = controlled ? externalTasks : internalTasks

  const fetchTasks = useCallback(async () => {
    if (controlled) return
    try {
      const res = await fetch('/api/tasks?assigned_to=!cri&status=open&limit=50')
      if (!res.ok) return
      const data = await res.json()
      setInternalTasks(data.tasks || data.issues || [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [controlled])

  useEffect(() => { if (!controlled) fetchTasks() }, [fetchTasks, controlled])

  // 10s polling for agent queue updates
  useSmartPoll(fetchTasks, 10000, { pauseWhenConnected: false })

  if (loading) return null

  return (
    <Queue className={cn('border-0 rounded-none shadow-none bg-transparent', className)}>
      <QueueSection defaultOpen={defaultOpen}>
        <QueueSectionTrigger className="px-3 py-2 hover:bg-secondary/50 transition-colors w-full text-left">
          <QueueSectionLabel
            label="Queued"
            count={tasks.length}
            className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
          />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList className="max-h-48">
            {tasks.length === 0 ? (
              <li className="px-3 py-3 text-xs text-muted-foreground/60 text-center">
                No agent tasks queued
              </li>
            ) : (
              tasks.map((task) => {
                const status = taskStatus(task)
                return (
                  <QueueItem
                    key={task.id}
                    onClick={() => onClickTask?.(task.id)}
                    className={cn('cursor-pointer', onClickTask && 'hover:bg-secondary/60')}
                  >
                    <div className="flex items-center gap-2 w-full min-w-0">
                      {/* Status indicator */}
                      {status === 'working' ? (
                        <span className="text-primary shrink-0 mt-0.5">
                          <SpinnerDot />
                        </span>
                      ) : (
                        <QueueItemIndicator completed={false} className="shrink-0 mt-0.5" />
                      )}

                      {/* Task title */}
                      <QueueItemContent className="flex-1 min-w-0 text-xs">
                        {task.title}
                      </QueueItemContent>

                      {/* Agent name (dimmed) */}
                      {task.assigned_to && (
                        <span className="text-[10px] text-muted-foreground/50 shrink-0 truncate max-w-[60px]">
                          {task.assigned_to}
                        </span>
                      )}
                    </div>
                  </QueueItem>
                )
              })
            )}
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  )
}
