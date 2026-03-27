import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '127.0.0.1'
const port = parseInt(process.env.PORT || '3333', 10)

const gatewayHost = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1'
const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT || '18789'
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || ''
const gatewayUrl = `ws://${gatewayHost}:${gatewayPort}`

// Ping/pong keepalive interval (30s)
const PING_INTERVAL_MS = 30_000
const PONG_TIMEOUT_MS = 10_000

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  // Track active proxy connections for cleanup and stats
  const activeConnections = new Map()

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url, true)

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        const connectionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        let clientClosed = false
        let gwClosed = false
        let pingTimer = null
        let pongTimer = null

        // Connect to gateway — pass token as header (how openclaw expects it)
        const gwWs = new WebSocket(gatewayUrl, {
          headers: gatewayToken ? { 'Authorization': `Bearer ${gatewayToken}` } : {}
        })

        let gwReady = false
        let msgCount = 0

        // --- Keepalive: ping/pong to detect stale connections ---
        const startKeepalive = () => {
          if (pingTimer) clearInterval(pingTimer)
          pingTimer = setInterval(() => {
            if (clientClosed || gwClosed) {
              cleanup()
              return
            }
            // Ping gateway; if no pong within timeout, assume dead
            if (gwWs.readyState === WebSocket.OPEN) {
              try {
                gwWs.ping()
              } catch {
                cleanup()
                return
              }
              // Set pong timeout
              if (pongTimer) clearTimeout(pongTimer)
              pongTimer = setTimeout(() => {
                console.log(`[ws-proxy:${connectionId}] GW pong timeout, closing`)
                cleanup()
              }, PONG_TIMEOUT_MS)
            }
          }, PING_INTERVAL_MS)
        }

        const onGwPong = () => {
          if (pongTimer) {
            clearTimeout(pongTimer)
            pongTimer = null
          }
        }

        const cleanup = () => {
          if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
          if (pongTimer) { clearTimeout(pongTimer); pongTimer = null }
          activeConnections.delete(connectionId)
          clientClosed = true
          gwClosed = true
          try { clientWs.close() } catch {}
          try { gwWs.close() } catch {}
        }

        // --- Gateway events ---
        gwWs.on('open', () => {
          console.log(`[ws-proxy:${connectionId}] Connected to gateway`)
          gwReady = true
          startKeepalive()
        })

        gwWs.on('pong', onGwPong)

        gwWs.on('message', (data, isBinary) => {
          if (msgCount < 6) {
            console.log(`[ws-proxy:${connectionId}] GW→Client:`, data.toString().slice(0, 200))
            msgCount++
          }
          if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
            try {
              clientWs.send(data, { binary: isBinary })
            } catch (e) {
              console.error(`[ws-proxy:${connectionId}] Error sending to client:`, e.message)
            }
          }
        })

        gwWs.on('close', (code, reason) => {
          console.log(`[ws-proxy:${connectionId}] GW closed: ${code} ${reason?.toString?.() || ''}`)
          gwClosed = true
          cleanup()
        })

        gwWs.on('error', (e) => {
          console.error(`[ws-proxy:${connectionId}] GW err:`, e.message)
          // Don't immediately close client — let client-side reconnect handle it
          gwClosed = true
          cleanup()
        })

        // --- Client events ---
        clientWs.on('message', (data, isBinary) => {
          if (msgCount < 3) {
            console.log(`[ws-proxy:${connectionId}] Client→GW:`, data.toString().slice(0, 200))
            msgCount++
          }
          if (gwReady && gwWs.readyState === WebSocket.OPEN) {
            try {
              gwWs.send(data, { binary: isBinary })
            } catch (e) {
              console.error(`[ws-proxy:${connectionId}] Error sending to gateway:`, e.message)
            }
          }
        })

        clientWs.on('close', (code, reason) => {
          console.log(`[ws-proxy:${connectionId}] Client closed: ${code}`)
          clientClosed = true
          cleanup()
        })

        clientWs.on('error', (e) => {
          console.error(`[ws-proxy:${connectionId}] Client err:`, e.message)
          clientClosed = true
          cleanup()
        })

        // Track connection
        activeConnections.set(connectionId, { clientWs, gwWs, started: Date.now() })
      })
    }
  })

  server.listen(port, hostname, () => {
    console.log(`> Mission Control ready on http://${hostname}:${port}`)
    console.log(`> WebSocket proxy: /ws → ${gatewayUrl} (token: ${gatewayToken ? 'yes' : 'no'})`)

    // Warm up critical routes to avoid cold-start timeouts on Discord interactions
    setTimeout(async () => {
      try {
        const warmups = [
          // Warm the full interaction handler path (xfeed rating + DB connections)
          fetch(`http://localhost:${port}/api/discord/interactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 3, data: { custom_id: 'xfeed_fire_warmup', component_type: 2 } }),
          }),
          // Warm the xfeed cards endpoint
          fetch(`http://localhost:${port}/api/xfeed/discord-cards`),
        ]
        await Promise.allSettled(warmups)
        console.log('> Route warmup complete')
      } catch { /* ignore warmup errors */ }
    }, 1000)
  })
})
