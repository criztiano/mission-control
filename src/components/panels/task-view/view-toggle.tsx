'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ViewMode = 'default' | 'compressed'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  className?: string
}

function DefaultIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="2" width="12" height="3" rx="0.5" />
      <rect x="2" y="7" width="12" height="3" rx="0.5" />
      <rect x="2" y="12" width="12" height="2" rx="0.5" />
    </svg>
  )
}

function CompressedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="3" x2="14" y2="3" />
      <line x1="2" y1="6" x2="14" y2="6" />
      <line x1="2" y1="9" x2="14" y2="9" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  )
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
