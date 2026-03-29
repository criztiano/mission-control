'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ViewMode = 'default' | 'compressed'

const STORAGE_KEY = 'eden-task-view-mode'

// ---------------------------------------------------------------------------
// Hook: persist view mode in localStorage
// ---------------------------------------------------------------------------

export function useViewMode(initial: ViewMode = 'default'): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return initial
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'default' || stored === 'compressed') return stored
    } catch {}
    return initial
  })

  const setAndPersist = (m: ViewMode) => {
    setMode(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch {}
  }

  return [mode, setAndPersist]
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function DefaultIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
      <rect x="2" y="2" width="12" height="3.5" rx="0.5" />
      <rect x="2" y="7.5" width="12" height="3.5" rx="0.5" />
      <rect x="2" y="13" width="12" height="1" rx="0.5" />
    </svg>
  )
}

function CompressedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="2" y1="3.5" x2="14" y2="3.5" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" />
      <line x1="2" y1="9.5" x2="14" y2="9.5" />
      <line x1="2" y1="12.5" x2="14" y2="12.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// ViewToggle component
// ---------------------------------------------------------------------------

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  className?: string
}

export function ViewToggle({ mode, onChange, className }: ViewToggleProps) {
  return (
    <div className={cn('flex items-center rounded-md border border-border overflow-hidden', className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onChange('default')}
        title="Default view"
        className={cn(
          'rounded-none border-0',
          mode === 'default' && 'bg-secondary text-foreground',
        )}
      >
        <DefaultIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onChange('compressed')}
        title="Compressed view"
        className={cn(
          'rounded-none border-0 border-l border-border',
          mode === 'compressed' && 'bg-secondary text-foreground',
        )}
      >
        <CompressedIcon />
      </Button>
    </div>
  )
}
