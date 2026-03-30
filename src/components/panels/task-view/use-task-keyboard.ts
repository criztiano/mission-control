import { useEffect, useCallback, RefObject } from 'react'

// ---------------------------------------------------------------------------
// Section types for Tab cycling
// ---------------------------------------------------------------------------

export type TaskViewSection = 'filter-bar' | 'task-list' | 'queue' | 'prompt'

const SECTION_ORDER: TaskViewSection[] = ['filter-bar', 'task-list', 'queue', 'prompt']

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseTaskKeyboardOptions {
  /** Total number of items in the task list */
  itemCount: number
  /** Currently keyboard-focused list index (-1 = none) */
  focusedIndex: number
  setFocusedIndex: (i: number) => void

  /** Callbacks */
  onEnter: (index: number) => void
  onSpace: (index: number) => void
  onEscape: () => void
  onSlash?: () => void

  /** When true, Escape still works but all other nav is blocked */
  isModalOpen?: boolean

  // Section refs for Tab cycling
  filterBarRef?: RefObject<HTMLElement | null>
  taskListRef?: RefObject<HTMLElement | null>
  queueRef?: RefObject<HTMLElement | null>
  promptRef?: RefObject<HTMLElement | null>

  /** Currently active section — for Tab highlight/focus */
  activeSection?: TaskViewSection
  onSectionChange?: (section: TaskViewSection) => void
}

// ---------------------------------------------------------------------------
// useTaskKeyboard
// ---------------------------------------------------------------------------

/**
 * Keyboard navigation hook for the task view panel.
 *
 * Key bindings (spec §6):
 *   ↑ / ↓       Move focus through task list items
 *   Space       Toggle checkbox on focused item
 *   Enter       Open/expand focused task
 *   Escape      Close detail / deselect all
 *   Tab         Cycle sections: filter-bar → task-list → queue → prompt
 *   Shift+Tab   Reverse cycle
 *   / or Cmd+K  Focus the prompt input
 *
 * Focus ring visibility is left to CSS (ring-2 ring-primary/50 on each item).
 */
export function useTaskKeyboard({
  itemCount,
  focusedIndex,
  setFocusedIndex,
  onEnter,
  onSpace,
  onEscape,
  onSlash,
  isModalOpen = false,
  filterBarRef,
  taskListRef,
  queueRef,
  promptRef,
  activeSection,
  onSectionChange,
}: UseTaskKeyboardOptions) {

  // Focus the DOM element for a given section
  const focusSection = useCallback((section: TaskViewSection) => {
    const refMap: Record<TaskViewSection, RefObject<HTMLElement | null> | undefined> = {
      'filter-bar': filterBarRef,
      'task-list': taskListRef,
      'queue': queueRef,
      'prompt': promptRef,
    }
    const ref = refMap[section]
    if (ref?.current) {
      // Find the first focusable element inside
      const focusable = ref.current.querySelector<HTMLElement>(
        'button, input, textarea, [tabindex="0"]'
      )
      focusable?.focus()
    }
    onSectionChange?.(section)
  }, [filterBarRef, taskListRef, queueRef, promptRef, onSectionChange])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      // --- Escape: always handled ---
      if (e.key === 'Escape') {
        onEscape()
        return
      }

      // --- Block remaining nav when modal is open ---
      if (isModalOpen) return

      // --- Tab: cycle sections ---
      if (e.key === 'Tab') {
        // Only intercept when the focus is inside our panel
        // (let natural tab work in inputs, unless we have section refs)
        if (filterBarRef || taskListRef || queueRef || promptRef) {
          e.preventDefault()
          const current = activeSection || 'task-list'
          const currentIdx = SECTION_ORDER.indexOf(current)
          const next = e.shiftKey
            ? SECTION_ORDER[(currentIdx - 1 + SECTION_ORDER.length) % SECTION_ORDER.length]
            : SECTION_ORDER[(currentIdx + 1) % SECTION_ORDER.length]
          focusSection(next)
        }
        return
      }

      // --- / or Cmd+K: focus prompt ---
      if (e.key === '/' && !inInput) {
        e.preventDefault()
        if (promptRef?.current) {
          const ta = promptRef.current.querySelector<HTMLElement>('textarea')
          ta?.focus()
        }
        onSlash?.()
        return
      }
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (promptRef?.current) {
          const ta = promptRef.current.querySelector<HTMLElement>('textarea')
          ta?.focus()
        }
        onSlash?.()
        return
      }

      // --- List navigation (only when not in an input) ---
      if (inInput) return

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          if (itemCount === 0) break
          const next = focusedIndex < 0 ? 0 : Math.min(focusedIndex + 1, itemCount - 1)
          setFocusedIndex(next)
          // Scroll focused item into view
          if (taskListRef?.current) {
            const rows = taskListRef.current.querySelectorAll<HTMLElement>('[role="row"]')
            rows[next]?.scrollIntoView({ block: 'nearest' })
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (itemCount === 0) break
          const prev = focusedIndex < 0 ? 0 : Math.max(focusedIndex - 1, 0)
          setFocusedIndex(prev)
          if (taskListRef?.current) {
            const rows = taskListRef.current.querySelectorAll<HTMLElement>('[role="row"]')
            rows[prev]?.scrollIntoView({ block: 'nearest' })
          }
          break
        }
        case 'Enter': {
          if (focusedIndex >= 0 && focusedIndex < itemCount) {
            e.preventDefault()
            onEnter(focusedIndex)
          }
          break
        }
        case ' ': {
          if (focusedIndex >= 0 && focusedIndex < itemCount) {
            e.preventDefault()
            onSpace(focusedIndex)
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [
    itemCount,
    focusedIndex,
    setFocusedIndex,
    onEnter,
    onSpace,
    onEscape,
    onSlash,
    isModalOpen,
    activeSection,
    focusSection,
    filterBarRef,
    taskListRef,
    queueRef,
    promptRef,
  ])
}
