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
}

/**
 * Visibility-aware polling hook that pauses when the browser tab is hidden
 * and resumes immediately when the tab becomes visible again.
 *
 * Always fires an initial fetch on mount (regardless of SSE/WS state)
 * to bootstrap component data. Subsequent polls respect pause options.
 *
 * Returns a function to manually trigger an immediate poll, plus
 * { error, retrying, retryCount } for displaying retry state in the UI.
 */
export function useSmartPoll(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: SmartPollOptions = {}
) {
  const {
    pauseWhenConnected = false,
    pauseWhenDisconnected = false,
    pauseWhenSseConnected = false,
    backoff = false,
    maxBackoffMultiplier = 3,
    enabled = true,
  } = options

  const callbackRef = useRef(callback)
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const backoffMultiplierRef = useRef(1)
  const isVisibleRef = useRef(true)
  const initialFiredRef = useRef(false)
  const inflightRef = useRef(false)

  // Error state for UI
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const { connection } = useMissionControl()

  // Keep callback ref current without re-triggering the effect
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  // Determine if ongoing polling should be active
  const shouldPoll = useCallback(() => {
    if (!enabled) return false
    if (!isVisibleRef.current) return false
    if (pauseWhenConnected && connection.isConnected) return false
    if (pauseWhenDisconnected && !connection.isConnected) return false
    if (pauseWhenSseConnected && connection.sseConnected) return false
    return true
  }, [enabled, pauseWhenConnected, pauseWhenDisconnected, pauseWhenSseConnected, connection.isConnected, connection.sseConnected])

  // Retry with exponential backoff (max 3 retries: 2s, 4s, 8s)
  const retryWithBackoff = useCallback(async (attempt: number): Promise<boolean> => {
    const delays = [2000, 4000, 8000]
    if (attempt >= delays.length) return false

    setRetrying(true)
    setRetryCount(attempt + 1)
    await new Promise(r => setTimeout(r, delays[attempt]))

    try {
      await callbackRef.current()
      setError(null)
      setRetrying(false)
      setRetryCount(0)
      backoffMultiplierRef.current = 1
      return true
    } catch {
      return retryWithBackoff(attempt + 1)
    }
  }, [])

  const fire = useCallback(() => {
    if (!shouldPoll()) return
    // Request deduplication: skip if previous request still in flight
    if (inflightRef.current) return

    inflightRef.current = true
    const result = callbackRef.current()

    if (result instanceof Promise) {
      result
        .then(() => {
          setError(null)
          setRetrying(false)
          setRetryCount(0)
          backoffMultiplierRef.current = 1
        })
        .catch((err) => {
          const msg = err?.message || 'Fetch failed'
          setError(msg)
          // Trigger retry with backoff (fire-and-forget)
          retryWithBackoff(0).finally(() => {
            inflightRef.current = false
          })
          return // inflight cleared in retry chain
        })
        .finally(() => {
          // Only clear inflight if no retry is happening
          if (!error) {
            inflightRef.current = false
          }
        })
    } else {
      inflightRef.current = false
    }
  }, [shouldPoll, error, retryWithBackoff])

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!shouldPoll()) return

    const effectiveInterval = backoff
      ? intervalMs * backoffMultiplierRef.current
      : intervalMs

    intervalRef.current = setInterval(() => {
      if (shouldPoll()) {
        fire()
      }
    }, effectiveInterval)
  }, [intervalMs, shouldPoll, backoff, fire])

  // Main effect: set up polling + visibility listener
  useEffect(() => {
    // Always fire initial fetch to bootstrap data, even if SSE/WS is connected.
    // SSE delivers events (agent.updated, etc.) but not the full initial state.
    if (!initialFiredRef.current && enabled) {
      initialFiredRef.current = true
      const result = callbackRef.current()
      if (result instanceof Promise) {
        result.catch((err) => {
          setError(err?.message || 'Initial fetch failed')
          // Attempt retry for initial load too
          retryWithBackoff(0)
        })
      }
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
        // Tab hidden: stop polling
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = undefined
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
    }
  }, [fire, startInterval, enabled, retryWithBackoff])

  // Restart interval when connection state changes (WS or SSE)
  useEffect(() => {
    startInterval()
  }, [connection.isConnected, connection.sseConnected, startInterval])

  // Return manual trigger + error state for UI
  return Object.assign(fire, {
    error,
    retrying,
    retryCount,
    clearError: () => {
      setError(null)
      setRetrying(false)
      setRetryCount(0)
    },
  })
}
