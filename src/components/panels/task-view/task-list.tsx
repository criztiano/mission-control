'use client'

import { forwardRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TaskListItem } from './task-list-item'
import { cn } from '@/lib/utils'
import type { Task } from '@/store'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskListProps {
  tasks: Task[]
  focusedIndex?: number
  selectedIds?: Set<string | number>
  activeId?: string | number | null
  compressed?: boolean
  onToggle?: (id: string | number) => void
  onClickTask?: (id: string | number) => void
  className?: string
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground/40">{count}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskList
// ---------------------------------------------------------------------------

export const TaskList = forwardRef<HTMLDivElement, TaskListProps>(
  function TaskList(
    {
      tasks,
      focusedIndex = -1,
      selectedIds = new Set(),
      activeId = null,
      compressed = false,
      onToggle,
      onClickTask,
      className,
    },
    ref,
  ) {
    // Split tasks: "My Tasks" = assigned to cri, "Drafts" = badge === 'idea' or unassigned
    const myTasks = tasks.filter(
      (t) => t.assigned_to === 'cri' && t.badge !== 'idea',
    )
    const drafts = tasks.filter(
      (t) => t.assigned_to !== 'cri' || t.badge === 'idea',
    )

    const renderItem = (task: Task, globalIndex: number) => (
      <TaskListItem
        key={task.id}
        task={task}
        isFocused={focusedIndex === globalIndex}
        isSelected={selectedIds.has(task.id)}
        isActive={activeId === task.id}
        compressed={compressed}
        onToggle={onToggle}
        onClick={onClickTask}
      />
    )

    let globalIdx = 0

    return (
      <ScrollArea ref={ref} className={cn('h-full', className)}>
        <div className="space-y-0.5 p-2">
          {myTasks.length > 0 && (
            <>
              <SectionHeader label="My Tasks" count={myTasks.length} />
              {myTasks.map((task) => renderItem(task, globalIdx++))}
            </>
          )}

          {drafts.length > 0 && (
            <>
              <SectionHeader label="Drafts" count={drafts.length} />
              {drafts.map((task) => renderItem(task, globalIdx++))}
            </>
          )}

          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">No tasks</p>
            </div>
          )}
        </div>
      </ScrollArea>
    )
  },
)
