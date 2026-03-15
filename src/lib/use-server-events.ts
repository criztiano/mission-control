'use client'

import { useEffect, useRef } from 'react'
import { useMissionControl } from '@/store'

interface ServerEvent {
  type: string
  data: any
  timestamp: number
}

// Reconnection backoff: 2s → 4s → 8s → max 30s
const RECONNECT_DELAYS = [2000, 4000, 8000, 15000, 30000]
const MAX_RECONNECT_DELAY = 30000

/**
 * Hook that connects to the SSE endpoint (/api/events) and dispatches
 * real-time DB mutation events to the Zustand store.
 *
 * SSE provides instant updates for all local-DB data (tasks, agents,
 * chat, activities, notifications), making REST polling a fallback.
 *
 * Features:
 * - Exponential backoff on reconnection (2s → 30s max)
 * - Manual reconnection trigger if EventSource fails
 * - Connection health tracking via sseConnected state
 * - Proper cleanup on unmount
 */
export function useServerEvents() {
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const reconnectAttemptsRef = useRef(0)
  const mountedRef = useRef(true)

  const {
    setConnection,
    addTask,
    updateTask,
    deleteTask,
    addAgent,
    updateAgent,
    addChatMessage,
    addNotification,
    addActivity,
  } = useMissionControl()

  useEffect(() => {
    mountedRef.current = true

    function connect() {
      if (!mountedRef.current) return
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      try {
        const es = new EventSource('/api/events')
        eventSourceRef.current = es

        es.onopen = () => {
          if (!mountedRef.current) { es.close(); return }
          reconnectAttemptsRef.current = 0 // Reset backoff on successful connect
          setConnection({ sseConnected: true })
        }

        es.onmessage = (event) => {
          if (!mountedRef.current) return
          try {
            const payload = JSON.parse(event.data) as ServerEvent
            dispatch(payload)
          } catch {
            // Ignore malformed events
          }
        }

        es.onerror = () => {
          if (!mountedRef.current) return
          setConnection({ sseConnected: false })
          es.close()
          eventSourceRef.current = null

          // Exponential backoff reconnection
          const attempt = Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS.length - 1)
          const delay = RECONNECT_DELAYS[attempt] || MAX_RECONNECT_DELAY
          reconnectAttemptsRef.current++

          console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`)
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        }
      } catch (err) {
        // EventSource constructor failed (rare, but possible)
        console.error('[SSE] Failed to create EventSource:', err)
        setConnection({ sseConnected: false })
        const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS.length - 1)]
        reconnectAttemptsRef.current++
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, delay)
      }
    }

    function dispatch(event: ServerEvent) {
      switch (event.type) {
        case 'connected':
          // Initial connection ack, nothing to do
          break

        // Task events
        case 'task.created':
          addTask(event.data)
          break
        case 'task.updated':
          if (event.data?.id) {
            updateTask(event.data.id, event.data)
          }
          break
        case 'task.status_changed':
          if (event.data?.id) {
            updateTask(event.data.id, {
              status: event.data.status,
              updated_at: event.data.updated_at,
            })
          }
          break
        case 'task.deleted':
          if (event.data?.id) {
            deleteTask(event.data.id)
          }
          break

        // Agent events
        case 'agent.created':
          addAgent(event.data)
          break
        case 'agent.updated':
        case 'agent.status_changed':
          if (event.data?.id) {
            updateAgent(event.data.id, event.data)
          }
          break

        // Chat events
        case 'chat.message':
          if (event.data?.id) {
            addChatMessage({
              id: event.data.id,
              conversation_id: event.data.conversation_id,
              from_agent: event.data.from_agent,
              to_agent: event.data.to_agent,
              content: event.data.content,
              message_type: event.data.message_type || 'text',
              metadata: event.data.metadata,
              read_at: event.data.read_at,
              created_at: event.data.created_at || Math.floor(Date.now() / 1000),
            })
          }
          break

        // Notification events
        case 'notification.created':
          if (event.data?.id) {
            addNotification({
              id: event.data.id as number,
              recipient: event.data.recipient || 'operator',
              type: event.data.type || 'info',
              title: event.data.title || '',
              message: event.data.message || '',
              source_type: event.data.source_type,
              source_id: event.data.source_id,
              created_at: event.data.created_at || Math.floor(Date.now() / 1000),
            })
          }
          break

        // Activity events
        case 'activity.created':
          if (event.data?.id) {
            addActivity({
              id: event.data.id as number,
              type: event.data.type,
              entity_type: event.data.entity_type,
              entity_id: event.data.entity_id,
              actor: event.data.actor,
              description: event.data.description,
              data: event.data.data,
              created_at: event.data.created_at || Math.floor(Date.now() / 1000),
            })
          }
          break
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      setConnection({ sseConnected: false })
    }
  }, [
    setConnection,
    addTask,
    updateTask,
    deleteTask,
    addAgent,
    updateAgent,
    addChatMessage,
    addNotification,
    addActivity,
  ])
}
