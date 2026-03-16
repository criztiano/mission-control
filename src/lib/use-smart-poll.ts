'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useMissionControl } from '@/store'

interface SmartPollOptions {
  /** Pause polling when WebSocket is connected (data comes via WS anyway) */
  pauseWhenConnected?: boolean
  /** Pause polling when WebSocket is disconnected (no point polling if server is down) */
  pauseWhenDisconnected?: boolean
  /** Pause polling when SSE is connected (real-time events replace polling) */
  pauseWhenSseConnected?: boolean
  /** Enable interval backoff when callback signals no new data */
  backoff?: boolean
  /** Maximum backoff multiplier (default: 3x) */
  maxBackoffMultiplier?: number
  /** Only poll when this returns true */
  enabled?: boolean
  /**
   * Number of automatic retries on fetch error before propagating error state.
   * Retries use exponential backoff: 2s, 4s, 8s.
   * Default: 3
   */
  retries?: number
}

interface SmartPollResult {
  /** Manual trigger for an immediate poll */
  trigger: () => void
  /** Last error from the callback (cleared on next successful poll or by clearError) */
  error: Error | null
  /** True while auto-retrying after an error */
  retrying: boolean
  /** Current retry attempt count */
  retryCount: number
  /** Clear the error state manually (useful for retry buttons) */
  clearError: () => void
}

const RETRY_BASE_DELAY_MS = 2000

/**
 * Visibility-aware polling hook that pauses when the browser tab is hidden
 * and resumes immediately when the tab becomes visible again.
 *
 * Always fires an initial fetch on mount (regardless of SSE/WS state)
 * to bootstrap component data. Subsequent polls respect pause options.
 *
 * Adds request deduplication (skips poll if previous is still in-flight),
 * exponential backoff on errors (up to `retries` attempts), and returns
 * error state for UI retry affordances.
 *
 * Returns a SmartPollResult with manual trigger and error state.
 */
export function useSmartPoll(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: SmartPollOptions = {}
): SmartPollResult {
  const {
    pauseWhenConnected = false,
    pauseWhenDisconnected = false,
    pauseWhenSseConnected = false,
    backoff = false,
    maxBackoffMultiplier = 3,
    enabled = true,
    retries = 3,
  } = options

  const callbackRef = useRef(callback)
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const retryTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const backoffMultiplierRef = useRef(1)
  const isVisibleRef = useRef(true)
  const initialFiredRef = useRef(false)
  /** True while a poll callback Promise is pending (deduplicate) */
  const inflightRef = useRef(false)
  /** True while scheduled retries are running (prevent premature inflight clear) */
  const retryingRef = useRef(false)

  const [error, setError] = useState<Error | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const { connection } = useMissionControl()

  // Keep callback ref current without re-triggering the effect
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const clearError = useCallback(() => {
    setError(null)
    setRetryCount(0)
    setRetrying(false)
    retryingRef.current = false
  }, [])

  // Determine if ongoing polling should be active
  const shouldPoll = useCallback(() => {
    if (!enabled) return false
    if (!isVisibleRef.current) return false
    if (pauseWhenConnected && connection.isConnected) return false
    if (pauseWhenDisconnected && !connection.isConnected) return false
    if (pauseWhenSseConnected && connection.sseConnected) return false
    return true
  }, [enabled, pauseWhenConnected, pauseWhenDisconnected, pauseWhenSseConnected, connection.isConnected, connection.sseConnected])

  /**
   * Run callback with retry logic on failure.
   * Skips if a previous call is still in-flight (deduplication).
   */
  const runWithRetry = useCallback((attempt = 0): void => {
    if (inflightRef.current) return
    inflightRef.current = true

    const result = callbackRef.current()
    if (!(result instanceof Promise)) {
      inflightRef.current = false
      return
    }

    result
      .then(() => {
        inflightRef.current = false
        retryingRef.current = false
        setError(null)
        setRetrying(false)
        setRetryCount(0)
        if (backoff) {
          backoffMultiplierRef.current = 1
        }
      })
      .catch((err: unknown) => {
        if (attempt < retries) {
          // Schedule retry with exponential backoff
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          retryingRef.current = true
          setRetrying(true)
          setRetryCount(attempt + 1)
          inflightRef.current = false
          retryTimeoutRef.current = setTimeout(() => {
            if (inflightRef.current) return
            runWithRetry(attempt + 1)
          }, delay)
        } else {
          // All retries exhausted — surface error
          inflightRef.current = false
          retryingRef.current = false
          setRetrying(false)
          setRetryCount(attempt)
          setError(err instanceof Error ? err : new Error(String(err)))
          if (backoff) {
            backoffMultiplierRef.current = Math.min(
              backoffMultiplierRef.current + 0.5,
              maxBackoffMultiplier
            )
          }
        }
      })
  }, [retries, backoff, maxBackoffMultiplier])

  const fire = useCallback(() => {
    if (!shouldPoll()) return
    runWithRetry(0)
  }, [shouldPoll, runWithRetry])

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!shouldPoll()) return

    const effectiveInterval = backoff
      ? intervalMs * backoffMultiplierRef.current
      : intervalMs

    intervalRef.current = setInterval(() => {
      if (shouldPoll()) {
        runWithRetry(0)
      }
    }, effectiveInterval)
  }, [intervalMs, shouldPoll, backoff, runWithRetry])

  // Main effect: set up polling + visibility listener
  useEffect(() => {
    // Always fire initial fetch to bootstrap data, even if SSE/WS is connected.
    // SSE delivers events (agent.updated, etc.) but not the full initial state.
    if (!initialFiredRef.current && enabled) {
      initialFiredRef.current = true
      runWithRetry(0)
    }

    // Start interval polling (respects shouldPoll for ongoing polls)
    startInterval()

    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible'

      if (isVisibleRef.current) {
        // Tab became visible: fire immediately, reset backoff, restart interval
        backoffMultiplierRef.current = 1
        fire()
        startInterval()
      } else {
        // Tab hidden: stop polling (cancel retry timers too)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = undefined
        }
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
          retryTimeoutRef.current = undefined
          retryingRef.current = false
          inflightRef.current = false
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = undefined
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = undefined
      }
    }
  }, [fire, startInterval, enabled, runWithRetry])

  // Restart interval when connection state changes (WS or SSE)
  useEffect(() => {
    startInterval()
  }, [connection.isConnected, connection.sseConnected, startInterval])

  return { trigger: fire, error, retrying, retryCount, clearError }
}
