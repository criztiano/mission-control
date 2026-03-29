'use client'

import { cn } from '@/lib/utils'
import type { Task } from '@/store'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskListItemProps {
  task: Task
  isFocused?: boolean
  isSelected?: boolean
  isActive?: boolean
  compressed?: boolean
  onToggle?: (id: string | number) => void
  onClick?: (id: string | number) => void
}

// ---------------------------------------------------------------------------
// Project badge color palette — cycle by project_id hash
// ---------------------------------------------------------------------------

const PROJECT_COLORS = [
  'bg-blue-500/15 text-blue-300 border-blue-500/25',
  'bg-purple-500/15 text-purple-300 border-purple-500/25',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  'bg-amber-500/15 text-amber-300 border-amber-500/25',
  'bg-rose-500/15 text-rose-300 border-rose-500/25',
  'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',
  'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
  'bg-orange-500/15 text-orange-300 border-orange-500/25',
]

function projectColor(projectId?: string): string {
  if (!projectId) return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
  let hash = 0
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length]
}

// ---------------------------------------------------------------------------
// Priority dot
// ---------------------------------------------------------------------------

function priorityDot(priority: string) {
  switch (priority) {
    case 'high': return 'bg-red-400'
    case 'medium': return 'bg-yellow-400'
    default: return 'bg-zinc-600'
  }
}

// ---------------------------------------------------------------------------
// TaskListItem
// ---------------------------------------------------------------------------

export function TaskListItem({
  task,
  isFocused = false,
  isSelected = false,
  isActive = false,
  compressed = false,
  onToggle,
  onClick,
}: TaskListItemProps) {
  const rowHeight = compressed ? 'h-8' : 'h-11'
  const textSize = compressed ? 'text-xs' : 'text-sm'
  const badgeSize = compressed ? 'text-[10px] px-1.5 py-0' : 'text-[11px] px-2 py-0.5'

  const colorClass = projectColor(task.project_id)

  return (
    <div
      role="row"
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isSelected}
      onClick={() => onClick?.(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.(task.id)
        if (e.key === ' ') { e.preventDefault(); onToggle?.(task.id) }
      }}
      className={cn(
        // Base
        'group flex w-full items-center gap-2 px-3 cursor-pointer select-none rounded-md border transition-all duration-100',
        rowHeight,
        // Default — transparent border
        'border-transparent',
        // Hover state (2)
        'hover:bg-zinc-800/50',
        // Focused state (3) — keyboard nav ring
        isFocused && 'ring-2 ring-primary/50 ring-offset-0',
        // Active state (5) — dashed border
        isActive && 'border-dashed border-primary/30 bg-primary/5',
      )}
    >
      {/* Checkbox — state 4 (Selected) */}
      <button
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        onClick={(e) => { e.stopPropagation(); onToggle?.(task.id) }}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
          isSelected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-zinc-600 bg-transparent hover:border-primary/60',
        )}
      >
        {isSelected && (
          <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,6 5,9 10,3" />
          </svg>
        )}
      </button>

      {/* Priority dot */}
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', priorityDot(task.priority))}
        title={task.priority}
      />

      {/* Title */}
      <span
        className={cn(
          'flex-1 truncate font-medium leading-none',
          textSize,
          isSelected ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
      >
        {task.title}
      </span>

      {/* Project badge */}
      {task.project_title && (
        <span
          className={cn(
            'shrink-0 rounded-full border font-medium leading-none',
            badgeSize,
            colorClass,
          )}
        >
          {task.project_title}
        </span>
      )}
    </div>
  )
}
