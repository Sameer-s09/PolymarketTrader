import { WebSocketServer, WebSocket } from 'ws'
import { bitstampEmitter, getCandles, type Candle } from './bitstamp'
import { updateWindowState } from '../signals/window'
import { computeSignalScore } from '../signals/score'
import { computeFibProximity } from '../signals/fib'
import { getCurrentSession } from '../utils/sessions'
import { getMarketCache, recordOddsSnapshot } from '../routes/polymarket'
import { resolveOpenTrades } from '../routes/trades'

const WS_PORT = 3002
const clients = new Set<WebSocket>()

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

function buildCandleMsg(candle: Candle) {
  const windowState = updateWindowState(candle)
  const session = getCurrentSession(candle.time)
  const market = getMarketCache()
  const oddsUp = market?.oddsUp ?? 0.5
  const oddsDown = market?.oddsDown ?? 0.5
  const signals = computeSignalScore(windowState, session, oddsUp, oddsDown)
  const fibProximity = windowState.prevWindowDirection
    ? computeFibProximity(
        candle.close,
        windowState.prevWindowHigh,
        windowState.prevWindowLow,
        windowState.prevWindowDirection
      )
    : null

  return {
    type: 'candle',
    data: {
      ...candle,
      windowState: {
        candleNum: windowState.candleNum,
        windowOpen: windowState.windowOpen,
        windowHigh: windowState.windowHigh,
        windowLow: windowState.windowLow,
        pctFromC1: windowState.pctFromC1,
        isLastInWindow: windowState.isLastInWindow,
        c1Open: windowState.c1Open,
        windowStartTime: windowState.windowStartTime,
      },
      signals: {
        ...signals,
        fibProximity,
        session,
        bodyPctPrev: windowState.prevWindowBodyPct,
        pctFromC1: windowState.pctFromC1,
        candleNum: windowState.candleNum,
      },
    },
  }
}

export function startBroadcaster() {
  const wss = new WebSocketServer({ port: WS_PORT })

  wss.on('listening', () => console.log(`[broadcaster] WebSocket server on :${WS_PORT}`))

  wss.on('connection', (ws) => {
    clients.add(ws)
    console.log(`[broadcaster] client connected (total: ${clients.size})`)

    ws.send(JSON.stringify({ type: 'connected', data: { timestamp: Date.now() } }))
    ws.send(JSON.stringify({ type: 'backfill', data: { candles: getCandles(200) } }))

    ws.on('close', () => {
      clients.delete(ws)
      console.log(`[broadcaster] client disconnected (total: ${clients.size})`)
    })
    ws.on('error', (err) => {
      console.error('[broadcaster] client error:', err.message)
      clients.delete(ws)
    })
  })

  // Live candle tick — broadcast every trade
  bitstampEmitter.on('candle_update', (candle: Candle) => {
    broadcast(buildCandleMsg(candle))
  })

  // Candle completed — broadcast it so the frontend store gets the completed bar
  bitstampEmitter.on('candle_complete', (candle: Candle) => {
    const msg = buildCandleMsg(candle) // isComplete: true
    // Record odds snapshot for this candle close
    recordOddsSnapshot(msg.data.windowState.candleNum, candle.close)
    broadcast(msg)

    // Also broadcast window_complete if this was C5
    const ws = msg.data.windowState
    if (ws.isLastInWindow) {
      const direction: 'UP' | 'DOWN' = candle.close >= ws.windowOpen ? 'UP' : 'DOWN'
      broadcast({
        type: 'window_complete',
        data: {
          windowOpen: ws.windowOpen,
          windowClose: candle.close,
          windowHigh: ws.windowHigh,
          windowLow: ws.windowLow,
          direction,
          bodyPct: msg.data.signals.bodyPctPrev,
          startTime: ws.windowStartTime,
          endTime: candle.time + 180,
        },
      })
      // Auto-resolve any open mock trades
      resolveOpenTrades(candle.close, direction)
    }
  })
}
