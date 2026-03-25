'use client'

import { useState, useCallback } from 'react'
import type { PlanComponent, PlanPoll, PlanChecklist, PlanThumbs, PlanApproval, PlanInput } from '@/lib/plan-parser'

// ── Response types ──

export interface PlanResponse {
  id: string
  kind: string
  [key: string]: unknown
}

interface PlanComponentsProps {
  components: PlanComponent[]
  responses: Record<string, PlanResponse>
  onChange: (id: string, response: PlanResponse) => void
  readOnly?: boolean
}

// ── Poll Component ──

function PollComponent({
  component,
  response,
  onChange,
  readOnly,
}: {
  component: PlanPoll
  response?: PlanResponse
  onChange: (r: PlanResponse) => void
  readOnly?: boolean
}) {
  const selected = (response?.selected as string) || ''
  const comment = (response?.comment as string) || ''

  return (
    <div className="my-4 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-200">{component.question}</p>
      <div className="space-y-2">
        {component.options.map((opt, i) => (
          <label
            key={i}
            className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
              selected === opt
                ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                : 'border-zinc-700/30 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
            } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
          >
            <div
              className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                selected === opt ? 'border-blue-500' : 'border-zinc-600'
              }`}
            >
              {selected === opt && <div className="h-2 w-2 rounded-full bg-blue-500" />}
            </div>
            {opt}
            <input
              type="radio"
              name={component.id}
              value={opt}
              checked={selected === opt}
              onChange={() =>
                onChange({ id: component.id, kind: 'poll', question: component.question, selected: opt, comment })
              }
              className="hidden"
              disabled={readOnly}
            />
          </label>
        ))}
      </div>
      {component.hasComment && (
        <textarea
          className="mt-3 w-full rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          placeholder="Add a comment (optional)..."
          rows={2}
          value={comment}
          onChange={(e) =>
            onChange({ id: component.id, kind: 'poll', question: component.question, selected, comment: e.target.value })
          }
          disabled={readOnly}
        />
      )}
    </div>
  )
}

// ── Checklist Component ──

function ChecklistComponent({
  component,
  response,
  onChange,
  readOnly,
}: {
  component: PlanChecklist
  response?: PlanResponse
  onChange: (r: PlanResponse) => void
  readOnly?: boolean
}) {
  const checked = ((response?.checked as number[]) || [])

  const toggle = (index: number) => {
    const next = checked.includes(index) ? checked.filter((i) => i !== index) : [...checked, index]
    onChange({
      id: component.id,
      kind: 'checklist',
      title: component.title,
      checked: next,
      unchecked: component.items.map((_, i) => i).filter((i) => !next.includes(i)),
    })
  }

  return (
    <div className="my-4 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-200">{component.title}</p>
      <div className="space-y-2">
        {component.items.map((item, i) => (
          <label
            key={i}
            className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              readOnly ? 'pointer-events-none opacity-60' : 'hover:bg-zinc-800/50'
            }`}
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                checked.includes(i)
                  ? 'border-green-500 bg-green-500/20'
                  : 'border-zinc-600'
              }`}
              onClick={() => !readOnly && toggle(i)}
            >
              {checked.includes(i) && (
                <svg className="h-3 w-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className={checked.includes(i) ? 'text-zinc-300' : 'text-zinc-400'}>{item}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Thumbs Component ──

function ThumbsComponent({
  component,
  response,
  onChange,
  readOnly,
}: {
  component: PlanThumbs
  response?: PlanResponse
  onChange: (r: PlanResponse) => void
  readOnly?: boolean
}) {
  const vote = (response?.vote as string) || ''
  const comment = (response?.comment as string) || ''

  const setVote = (v: 'up' | 'down') => {
    onChange({ id: component.id, kind: 'thumbs', question: component.question, vote: v, comment })
  }

  return (
    <div className="my-4 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-200">{component.question}</p>
      <div className="flex gap-3">
        <button
          onClick={() => !readOnly && setVote('up')}
          className={`rounded-md px-4 py-2 text-lg transition-colors ${
            vote === 'up'
              ? 'bg-green-500/20 ring-1 ring-green-500/50'
              : 'bg-zinc-800 hover:bg-zinc-700'
          } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
        >
          👍
        </button>
        <button
          onClick={() => !readOnly && setVote('down')}
          className={`rounded-md px-4 py-2 text-lg transition-colors ${
            vote === 'down'
              ? 'bg-red-500/20 ring-1 ring-red-500/50'
              : 'bg-zinc-800 hover:bg-zinc-700'
          } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
        >
          👎
        </button>
      </div>
      {component.hasComment && (
        <textarea
          className="mt-3 w-full rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          placeholder="Add a comment (optional)..."
          rows={2}
          value={comment}
          onChange={(e) =>
            onChange({ id: component.id, kind: 'thumbs', question: component.question, vote, comment: e.target.value })
          }
          disabled={readOnly}
        />
      )}
    </div>
  )
}

// ── Approval Component ──

function ApprovalComponent({
  component,
  response,
  onChange,
  readOnly,
}: {
  component: PlanApproval
  response?: PlanResponse
  onChange: (r: PlanResponse) => void
  readOnly?: boolean
}) {
  const approved = response?.approved as boolean | undefined
  const comment = (response?.comment as string) || ''

  return (
    <div className="my-4 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-200">📋 {component.title}</p>
      <div className="flex gap-3">
        <button
          onClick={() => !readOnly && onChange({ id: component.id, kind: 'approval', title: component.title, approved: true, comment })}
          className={`rounded-md px-6 py-2.5 text-sm font-medium transition-colors ${
            approved === true
              ? 'bg-green-600 text-white ring-1 ring-green-400/50'
              : 'bg-zinc-800 text-zinc-400 hover:bg-green-900/30 hover:text-green-300'
          } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
        >
          ✅ Approve
        </button>
        <button
          onClick={() => !readOnly && onChange({ id: component.id, kind: 'approval', title: component.title, approved: false, comment })}
          className={`rounded-md px-6 py-2.5 text-sm font-medium transition-colors ${
            approved === false
              ? 'bg-red-600 text-white ring-1 ring-red-400/50'
              : 'bg-zinc-800 text-zinc-400 hover:bg-red-900/30 hover:text-red-300'
          } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
        >
          🔄 Request Changes
        </button>
      </div>
      {approved === false && (
        <textarea
          className="mt-3 w-full rounded-md border border-red-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-500 focus:border-red-500 focus:outline-none"
          placeholder="What needs to change? (required)"
          rows={3}
          value={comment}
          onChange={(e) =>
            onChange({ id: component.id, kind: 'approval', title: component.title, approved: false, comment: e.target.value })
          }
          disabled={readOnly}
        />
      )}
      {approved === true && (
        <textarea
          className="mt-3 w-full rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          placeholder="Any notes? (optional)"
          rows={2}
          value={comment}
          onChange={(e) =>
            onChange({ id: component.id, kind: 'approval', title: component.title, approved: true, comment: e.target.value })
          }
          disabled={readOnly}
        />
      )}
    </div>
  )
}

// ── Input Component ──

function InputComponent({
  component,
  response,
  onChange,
  readOnly,
}: {
  component: PlanInput
  response?: PlanResponse
  onChange: (r: PlanResponse) => void
  readOnly?: boolean
}) {
  const value = (response?.value as string) || ''

  return (
    <div className="my-4 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-200">{component.prompt}</p>
      <textarea
        className="w-full rounded-md border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
        placeholder="Your thoughts..."
        rows={3}
        value={value}
        onChange={(e) =>
          onChange({ id: component.id, kind: 'input', prompt: component.prompt, value: e.target.value })
        }
        disabled={readOnly}
      />
    </div>
  )
}

// ── Main Renderer ──

export function PlanComponentRenderer({
  component,
  response,
  onChange,
  readOnly,
}: {
  component: PlanComponent
  response?: PlanResponse
  onChange: (r: PlanResponse) => void
  readOnly?: boolean
}) {
  switch (component.kind) {
    case 'poll':
      return <PollComponent component={component} response={response} onChange={onChange} readOnly={readOnly} />
    case 'checklist':
      return <ChecklistComponent component={component} response={response} onChange={onChange} readOnly={readOnly} />
    case 'thumbs':
      return <ThumbsComponent component={component} response={response} onChange={onChange} readOnly={readOnly} />
    case 'approval':
      return <ApprovalComponent component={component} response={response} onChange={onChange} readOnly={readOnly} />
    case 'input':
      return <InputComponent component={component} response={response} onChange={onChange} readOnly={readOnly} />
    default:
      return null
  }
}

// ── Collected Responses Hook ──

export function usePlanResponses() {
  const [responses, setResponses] = useState<Record<string, PlanResponse>>({})

  const handleChange = useCallback((id: string, response: PlanResponse) => {
    setResponses((prev) => ({ ...prev, [id]: response }))
  }, [])

  const getResponseArray = useCallback(() => {
    return Object.values(responses)
  }, [responses])

  return { responses, handleChange, getResponseArray }
}
