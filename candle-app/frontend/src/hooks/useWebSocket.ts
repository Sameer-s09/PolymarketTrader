import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import type { WsMessage } from '../types/candle'

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const port  = window.location.port
  // Dev (Vite port 5173): connect directly to WS server on :3002
  if (port && port !== '80' && port !== '443') {
    return `${proto}//${window.location.hostname}:3002`
  }
  // Production: route through Nginx /ws → :3002
  return `${proto}//${window.location.host}/ws`
})()
const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000]

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const attemptRef = useRef(0)

  useEffect(() => {
    let destroyed = false

    function connect() {
      if (destroyed) return
      // Read store actions at call time — Zustand actions are stable refs
      const { addCandles, updateCandle, setWsStatus } = useAppStore.getState()
      setWsStatus('connecting')
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        attemptRef.current = 0
        useAppStore.getState().setWsStatus('connected')
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage
          const store = useAppStore.getState()
          if (msg.type === 'backfill') {
            store.addCandles(msg.data.candles)
          } else if (msg.type === 'candle') {
            store.updateCandle(msg.data, msg.data.windowState, msg.data.signals)
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onclose = () => {
        if (destroyed) return
        useAppStore.getState().setWsStatus('disconnected')
        const delay = BACKOFF[Math.min(attemptRef.current, BACKOFF.length - 1)]
        attemptRef.current++
        console.log(`[ws] reconnecting in ${delay}ms (attempt ${attemptRef.current})`)
        setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      destroyed = true
      wsRef.current?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Mount once — store actions are stable, accessed via getState()
}
