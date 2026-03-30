'use client'

import { useCallback, useRef, useState } from 'react'
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Project {
  id: string
  title?: string
  name?: string
  description?: string
}

interface Agent {
  id: string | number
  name: string
  role?: string
}

interface TaskPromptInputProps {
  /** Active project filter to pass to the API */
  activeProjectId?: string | null
  projects?: Project[]
  agents?: Agent[]
  /** Called after a task is successfully created */
  onCreated?: () => void
  className?: string
  /** Expose ref to the textarea for keyboard shortcut focus */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}

// ---------------------------------------------------------------------------
// TaskPromptInput
// ---------------------------------------------------------------------------

export function TaskPromptInput({
  activeProjectId,
  projects = [],
  agents = [],
  onCreated,
  className,
  textareaRef,
}: TaskPromptInputProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (msg: { text: string }) => {
      const text = msg.text.trim()
      if (!text) return

      setSubmitting(true)
      setError(null)

      try {
        const res = await fetch('/api/tasks/create-from-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: text,
            active_project_filter: activeProjectId ?? null,
            projects: projects.map((p) => ({
              id: p.id,
              title: p.title || p.name,
              description: p.description,
            })),
            agents: agents.map((a) => ({
              id: String(a.id),
              name: a.name,
              role: a.role,
            })),
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to create task')
        }

        onCreated?.()
      } catch (e: any) {
        setError(e.message)
      } finally {
        setSubmitting(false)
      }
    },
    [activeProjectId, projects, agents, onCreated],
  )

  return (
    <div className={cn('px-3 pb-3 pt-1', className)}>
      <PromptInput
        onSubmit={handleSubmit}
        className="rounded-xl border border-border bg-card shadow-sm"
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder="Add a task… @agent to assign, /project to tag, /new for new project"
            className="min-h-10 max-h-32 resize-none bg-transparent px-3 py-2.5 text-sm"
          />
        </PromptInputBody>
        <PromptInputFooter className="px-3 pb-2.5 pt-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[10px] text-muted-foreground/50 truncate">
              Enter to submit · Shift+Enter new line · @agent · /project
            </span>
            {error && (
              <span className="text-[10px] text-red-400 truncate">{error}</span>
            )}
          </div>
          <PromptInputSubmit
            disabled={submitting}
            status={submitting ? 'submitted' : undefined}
            className="ml-2 shrink-0"
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
