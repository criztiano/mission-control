import { useEffect } from 'react'

interface UseTaskKeyboardOptions {
  itemCount: number
  focusedIndex: number
  setFocusedIndex: (i: number) => void
  onEnter: (index: number) => void
  onSpace: (index: number) => void
  onEscape: () => void
  onSlash?: () => void
  isModalOpen?: boolean
}

/**
 * Keyboard navigation for task list:
 *   ↑ / ↓       Move focus between items
 *   Space       Toggle checkbox on focused item
 *   Enter       Open/expand focused task
 *   Escape      Close detail / deselect
 *   / or Cmd+K  Focus prompt input (optional)
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
}: UseTaskKeyboardOptions) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Always handle Escape
      if (e.key === 'Escape') {
        onEscape()
        return
      }

      // Block nav when modal open
      if (isModalOpen) return

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          setFocusedIndex(Math.min(focusedIndex + 1, itemCount - 1))
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          setFocusedIndex(Math.max(focusedIndex - 1, 0))
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
          if (
            focusedIndex >= 0 &&
            focusedIndex < itemCount &&
            (e.target as HTMLElement).tagName !== 'INPUT' &&
            (e.target as HTMLElement).tagName !== 'TEXTAREA'
          ) {
            e.preventDefault()
            onSpace(focusedIndex)
          }
          break
        }
        case '/': {
          if (
            (e.target as HTMLElement).tagName !== 'INPUT' &&
            (e.target as HTMLElement).tagName !== 'TEXTAREA'
          ) {
            e.preventDefault()
            onSlash?.()
          }
          break
        }
        case 'k': {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onSlash?.()
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [itemCount, focusedIndex, setFocusedIndex, onEnter, onSpace, onEscape, onSlash, isModalOpen])
}
