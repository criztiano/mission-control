'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parsePlan, type PlanSegment } from '@/lib/plan-parser'
import { PlanComponentRenderer, usePlanResponses, type PlanResponse } from '@/components/ui/plan-components'
import { Button } from '@/components/ui/button'

// ── Status badge ──

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  review: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  approved: 'bg-green-900/40 text-green-300 border-green-700/50',
  rejected: 'bg-red-900/40 text-red-300 border-red-700/50',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {status}
    </span>
  )
}

// ── Plan data shape ──

interface PlanData {
  id: string
  title: string
  content: string
  task_id: string | null
  project_id: string | null
  author: string
  status: string
  responses: Record<string, PlanResponse>
  created_at: string
  updated_at: string
}

interface LinkedTask {
  id: string
  title: string
  status: string
}

// ── Main Page ──

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [plan, setPlan] = useState<PlanData | null>(null)
  const [linkedTask, setLinkedTask] = useState<LinkedTask | null>(null)
  const [linkedProjectTitle, setLinkedProjectTitle] = useState<string | null>(null)
  const [segments, setSegments] = useState<PlanSegment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const { responses, handleChange } = usePlanResponses()

  // Load plan
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/plans/${id}`)
        if (!res.ok) {
          if (res.status === 404) setError('Plan not found')
          else setError('Failed to load plan')
          return
        }
        const data = await res.json()
        const p: PlanData = data.plan
        setPlan(p)
        setSegments(parsePlan(p.content))

        // Load linked task
        if (p.task_id) {
          const taskRes = await fetch(`/api/tasks/${p.task_id}`)
          if (taskRes.ok) {
            const taskData = await taskRes.json()
            setLinkedTask({ id: taskData.task.id, title: taskData.task.title, status: taskData.task.status })
          }
        }

        // Load linked project
        if (p.project_id) {
          const projRes = await fetch(`/api/projects/${p.project_id}`)
          if (projRes.ok) {
            const projData = await projRes.json()
            setLinkedProjectTitle(projData.project?.title || null)
          }
        }
      } catch {
        setError('Failed to load plan')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const handleSubmit = async () => {
    if (submitting || submitted) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/plans/${id}/respond`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      })
      if (res.ok) {
        setSubmitted(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading plan…</div>
      </div>
    )
  }

  if (error || !plan) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-foreground font-medium mb-2">{error || 'Plan not found'}</p>
          <Button variant="outline" size="sm" onClick={() => router.back()}>Go back</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-foreground truncate">{plan.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {/* Author */}
                <span className="text-muted-foreground">
                  by <span className="font-medium text-foreground">{plan.author}</span>
                </span>

                {/* Status */}
                <StatusBadge status={plan.status} />

                {/* Linked task */}
                {linkedTask && (
                  <button
                    onClick={() => router.push(`/?task=${linkedTask.id}`)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-zinc-600 hover:text-foreground"
                  >
                    📋 {linkedTask.title}
                  </button>
                )}

                {/* Linked project */}
                {linkedProjectTitle && (
                  <span className="text-xs text-muted-foreground border border-border rounded-md px-2 py-0.5 bg-surface-1">
                    {linkedProjectTitle}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body — interleaved markdown + components */}
      <div className="mx-auto max-w-3xl px-6 py-8 pb-32">
        {segments.map((segment, i) => {
          if (segment.type === 'markdown' && segment.content) {
            return (
              <div
                key={i}
                className="prose prose-invert prose-sm max-w-none
                  prose-headings:font-semibold prose-headings:text-foreground
                  prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
                  prose-p:text-muted-foreground prose-p:leading-relaxed
                  prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-foreground prose-strong:font-semibold
                  prose-code:bg-zinc-800 prose-code:text-zinc-300 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs
                  prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded-lg
                  prose-ul:list-disc prose-ul:pl-4 prose-ol:list-decimal prose-ol:pl-4
                  prose-li:text-muted-foreground
                  prose-blockquote:border-l-2 prose-blockquote:border-zinc-700 prose-blockquote:pl-4 prose-blockquote:text-muted-foreground
                  prose-hr:border-zinc-700"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment.content}</ReactMarkdown>
              </div>
            )
          }

          if (segment.type === 'component' && segment.component) {
            return (
              <PlanComponentRenderer
                key={i}
                component={segment.component}
                response={responses[segment.component.id]}
                onChange={(r) => handleChange(segment.component!.id, r)}
                readOnly={submitted}
              />
            )
          }

          return null
        })}
      </div>

      {/* Sticky footer — Submit Feedback */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-6 py-3 flex items-center justify-between gap-4">
          {submitted ? (
            <p className="text-sm text-green-400 font-medium">✅ Feedback submitted — thank you!</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {Object.keys(responses).length > 0
                  ? `${Object.keys(responses).length} response${Object.keys(responses).length !== 1 ? 's' : ''} ready`
                  : 'Fill in the interactive components above'}
              </p>
              <Button
                onClick={handleSubmit}
                disabled={submitting || Object.keys(responses).length === 0}
                size="sm"
              >
                {submitting ? 'Submitting…' : 'Submit Feedback'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
