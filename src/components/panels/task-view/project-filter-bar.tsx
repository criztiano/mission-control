'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ViewToggle, type ViewMode } from './view-toggle'
import { NavArrowDown } from 'iconoir-react'

export interface ProjectFilter {
  id: string | null
  title: string
  emoji?: string
  openCount?: number
}

interface ProjectFilterBarProps {
  projects: ProjectFilter[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  className?: string
}

export function ProjectFilterBar({
  projects,
  activeProjectId,
  onSelectProject,
  viewMode,
  onViewModeChange,
  className,
}: ProjectFilterBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  // 3 most recently-active projects for inline chips
  const inlineProjects = projects.slice(0, 3)

  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0', className)}>
      {/* ALL PROJECTS dropdown */}
      <div ref={dropdownRef} className="relative shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={cn(
            'h-7 gap-1 text-[11px] font-bold uppercase tracking-widest px-2',
            activeProjectId === null && 'text-foreground',
            activeProjectId !== null && 'text-muted-foreground',
          )}
        >
          All Projects
          <NavArrowDown className="w-3 h-3" />
        </Button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] bg-card border border-border rounded-lg shadow-lg overflow-hidden">
            {/* All Projects option */}
            <button
              onClick={() => { onSelectProject(null); setDropdownOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-secondary transition-colors',
                activeProjectId === null && 'bg-secondary/50 text-foreground',
              )}
            >
              <span className="text-sm">🗂️</span>
              <span className="flex-1 font-medium">All Projects</span>
            </button>
            <div className="border-t border-border/50 my-0.5" />
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => { onSelectProject(p.id); setDropdownOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-secondary transition-colors',
                  activeProjectId === p.id && 'bg-secondary/50 text-foreground',
                )}
              >
                {p.emoji && <span className="text-sm shrink-0">{p.emoji}</span>}
                <span className="flex-1 truncate">{p.title}</span>
                {p.openCount !== undefined && (
                  <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{p.openCount}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Separator */}
      {inlineProjects.length > 0 && (
        <span className="text-muted-foreground/30 text-xs select-none">→</span>
      )}

      {/* Inline project chips */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
        {inlineProjects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectProject(activeProjectId === p.id ? null : p.id)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors shrink-0',
              'border',
              activeProjectId === p.id
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-border/80',
            )}
          >
            {p.emoji && <span>{p.emoji}</span>}
            <span className="truncate max-w-[80px]">{p.title}</span>
            {p.openCount !== undefined && (
              <span className={cn(
                'rounded-full px-1 text-[9px] font-bold',
                activeProjectId === p.id ? 'bg-primary/20' : 'bg-secondary-foreground/10',
              )}>
                {p.openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* View toggle (right side) */}
      <ViewToggle mode={viewMode} onChange={onViewModeChange} className="shrink-0 ml-auto" />
    </div>
  )
}
