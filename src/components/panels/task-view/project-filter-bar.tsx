'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ViewToggle, type ViewMode } from './view-toggle'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFilter {
  id: string | null
  title: string
  emoji?: string
  /** open_task_count from /api/projects?with_counts=true */
  openCount?: number
  lastActivity?: number
}

interface ProjectFilterBarProps {
  projects: ProjectFilter[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  className?: string
}

// ---------------------------------------------------------------------------
// ProjectFilterBar
// ---------------------------------------------------------------------------

export function ProjectFilterBar({
  projects,
  activeProjectId,
  onSelectProject,
  viewMode,
  onViewModeChange,
  className,
}: ProjectFilterBarProps) {
  // 3 most recently-active projects as inline chips
  const inlineProjects = projects
    .filter((p) => p.id !== null)
    .slice(0, 3)

  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0', className)}>
      {/* ALL PROJECTS dropdown — shadcn DropdownMenu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 gap-1 text-[11px] font-bold uppercase tracking-widest px-2',
              activeProjectId !== null && 'text-muted-foreground',
            )}
          >
            All Projects
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
              <polyline points="4,6 8,10 12,6" />
            </svg>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          {/* All Projects option */}
          <DropdownMenuItem
            onClick={() => onSelectProject(null)}
            className={cn('gap-2', activeProjectId === null && 'bg-secondary/50 font-medium')}
          >
            <span>🗂️</span>
            <span className="flex-1">All Projects</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => onSelectProject(p.id)}
              className={cn('gap-2', activeProjectId === p.id && 'bg-secondary/50 font-medium')}
            >
              {p.emoji && <span className="text-sm shrink-0">{p.emoji}</span>}
              <span className="flex-1 truncate">{p.title}</span>
              {p.openCount !== undefined && (
                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{p.openCount}</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Arrow separator */}
      {inlineProjects.length > 0 && (
        <span className="text-muted-foreground/30 text-xs select-none">→</span>
      )}

      {/* Inline project chips — 3 most recently updated */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
        {inlineProjects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectProject(activeProjectId === p.id ? null : p.id)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors shrink-0 border',
              activeProjectId === p.id
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-border/80',
            )}
          >
            {p.emoji && <span className="leading-none">{p.emoji}</span>}
            <span className="truncate max-w-[80px]">{p.title}</span>
            {p.openCount !== undefined && (
              <span className={cn(
                'rounded-full px-1 text-[9px] font-bold leading-none',
                activeProjectId === p.id ? 'bg-primary/20' : 'bg-secondary-foreground/10',
              )}>
                {p.openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* View toggle — right side */}
      <ViewToggle mode={viewMode} onChange={onViewModeChange} className="shrink-0 ml-auto" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hook: load projects with counts for the filter bar
// ---------------------------------------------------------------------------

export function useProjectFilters() {
  const [projects, setProjects] = useState<ProjectFilter[]>([])
  const [loading, setLoading] = useState(true)

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects?with_counts=true')
      if (!res.ok) return
      const data = await res.json()
      const list: ProjectFilter[] = (data.projects || []).map((p: any) => ({
        id: p.id,
        title: p.title,
        emoji: p.emoji,
        openCount: p.open_task_count ?? 0,
        lastActivity: p.lastActivity ?? 0,
      }))
      setProjects(list)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  return { projects, loading, refetch: fetchProjects }
}
