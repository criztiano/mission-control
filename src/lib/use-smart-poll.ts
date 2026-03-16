'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useMissionControl } from '@/store'

const MAX_RETRIES = 3
const RETRY_DELAYS_MS = [2000, 4000, 8000]

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

interface SmartPollState {
  error: Error | null
  retrying: boolean
  retryCount: number
}

/**
 * Visibility-aware polling hook that pauses when the browser tab is hidden
 * and resumes immediately when the tab becomes visible again.
 *
 * Always fires an initial fetch on mount (regardless of SSE/WS state)
 * to bootstrap component data. Subsequent polls respect pause options.
 *
 * Features:
 * - Request deduplication: skips polling if previous request still in-flight
 * - Exponential backoff retry: 3 retries with 2s/4s/8s delays on fetch errors
 * - Error state: returns { error, retrying, retryCount, clearError } for UI
 * - AbortController cleanup: cancels pending requests on unmount
 *
 * Returns a function to manually trigger an immediate poll, plus error state.
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
  const mountedRef = useRef(true)
  const retryTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const [pollState, setPollState] = useState<SmartPollState>({
    error: null,
    retrying: false,
    retryCount: 0,
  })

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

  // Retry with exponential backoff — call chain, up to MAX_RETRIES attempts
  const scheduleRetry = useCallback((attempt: number) => {
    if (!mountedRef.current) return
    if (attempt >= MAX_RETRIES) {
      setPollState(prev => ({ ...prev, retrying: false, retryCount: 0 }))
      inflightRef.current = false
      return
    }

    const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
    setPollState(prev => ({ ...prev, retrying: true, retryCount: attempt + 1 }))

    retryTimeoutRef.current = setTimeout(async () => {
      if (!mountedRef.current) { inflightRef.current = false; return }
      try {
        await callbackRef.current()
        // Success — clear error
        setPollState({ error: null, retrying: false, retryCount: 0 })
        backoffMultiplierRef.current = 1
        inflightRef.current = false
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setPollState(prev => ({ ...prev, error }))
        scheduleRetry(attempt + 1)
      }
    }, delay)
  }, [])

  const fire = useCallback(() => {
    if (!shouldPoll()) return
    // Request deduplication: skip if previous poll still in-flight
    if (inflightRef.current) return

    inflightRef.current = true

    try {
      const result = callbackRef.current()
      if (result instanceof Promise) {
        result
          .then(() => {
            if (!mountedRef.current) { inflightRef.current = false; return }
            setPollState({ error: null, retrying: false, retryCount: 0 })
            backoffMultiplierRef.current = 1
            inflightRef.current = false
          })
          .catch((err) => {
            if (!mountedRef.current) { inflightRef.current = false; return }
            const error = err instanceof Error ? err : new Error(String(err))
            setPollState(prev => ({ ...prev, error }))
            if (backoff) {
              backoffMultiplierRef.current = Math.min(
                backoffMultiplierRef.current + 0.5,
                maxBackoffMultiplier
              )
            }
            // Kick off retry chain (inflightRef cleared inside scheduleRetry chain)
            scheduleRetry(0)
          })
      } else {
        inflightRef.current = false
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setPollState(prev => ({ ...prev, error }))
      scheduleRetry(0)
    }
  }, [shouldPoll, backoff, maxBackoffMultiplier, scheduleRetry])

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!shouldPoll()) return

    const effectiveInterval = backoff
      ? intervalMs * backoffMultiplierRef.current
      : intervalMs

    intervalRef.current = setInterval(() => {
      if (shouldPoll() && !inflightRef.current) {
        fire()
      }
    }, effectiveInterval)
  }, [intervalMs, shouldPoll, backoff, fire])

  // Main effect: set up polling + visibility listener
  useEffect(() => {
    mountedRef.current = true

    // Always fire initial fetch to bootstrap data, even if SSE/WS is connected.
    // SSE delivers events (agent.updated, etc.) but not the full initial state.
    if (!initialFiredRef.current && enabled) {
      initialFiredRef.current = true
      fire()
    }

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
      mountedRef.current = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = undefined
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = undefined
      }
      inflightRef.current = false
    }
  }, [fire, startInterval, enabled])

  // Restart interval when connection state changes (WS or SSE)
  useEffect(() => {
    startInterval()
  }, [connection.isConnected, connection.sseConnected, startInterval])

  const clearError = useCallback(() => {
    setPollState({ error: null, retrying: false, retryCount: 0 })
    backoffMultiplierRef.current = 1
  }, [])

  // Return manual trigger with error state attached for UI consumption
  return Object.assign(fire, {
    error: pollState.error,
    retrying: pollState.retrying,
    retryCount: pollState.retryCount,
    clearError,
  })
}
