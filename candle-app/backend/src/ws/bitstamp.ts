import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { db } from '../db/index'

const insertCandle = db.prepare(`
  INSERT OR REPLACE INTO candles (time, open, high, low, close, volume)
  VALUES (@time, @open, @high, @low, @close, @volume)
`)

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  isComplete: boolean
}

interface BitstampTrade {
  price: number | string
  amount: number | string
  timestamp: string
  type: number
}

const CANDLE_SECONDS = 180 // 3 minutes
const RECONNECT_DELAY = 3000
const MAX_CANDLES = 500
const TRADE_TIMEOUT_MS = 45_000 // reconnect if no trade for 45s

const emitter = new EventEmitter()
const completedCandles: Candle[] = []
let currentCandle: Candle | null = null

function candleKey(timestamp: number): number {
  return Math.floor(timestamp / CANDLE_SECONDS) * CANDLE_SECONDS
}

function onTrade(price: number, amount: number, timestamp: number) {
  const key = candleKey(timestamp)

  if (!currentCandle) {
    currentCandle = { time: key, open: price, high: price, low: price, close: price, volume: amount, isComplete: false }
  } else if (key !== currentCandle.time) {
    // Close the current candle
    const closed: Candle = { ...currentCandle, isComplete: true }
    completedCandles.push(closed)
    if (completedCandles.length > MAX_CANDLES) completedCandles.shift()
    // Persist to SQLite for volatility analysis
    try { insertCandle.run(closed) } catch { /* ignore duplicate */ }
    emitter.emit('candle_complete', closed)

    // Open new candle
    currentCandle = { time: key, open: price, high: price, low: price, close: price, volume: amount, isComplete: false }
  } else {
    currentCandle.high = Math.max(currentCandle.high, price)
    currentCandle.low = Math.min(currentCandle.low, price)
    currentCandle.close = price
    currentCandle.volume += amount
  }

  emitter.emit('candle_update', { ...currentCandle })
}

function connect() {
  const ws = new WebSocket('wss://ws.bitstamp.net')
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let dead = false

  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      if (!dead) {
        dead = true
        console.log('[bitstamp] no trades for 45s — reconnecting')
        ws.terminate()
      }
    }, TRADE_TIMEOUT_MS)
  }

  ws.on('open', () => {
    console.log('[bitstamp] connected')
    ws.send(JSON.stringify({
      event: 'bts:subscribe',
      data: { channel: 'live_trades_btcusd' }
    }))
    resetWatchdog()
  })

  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as { event: string; channel?: string; data: BitstampTrade | string }

      // Respond to Pusher heartbeats so the server doesn't drop us silently
      if (msg.event === 'bts:heartbeat') {
        ws.send(JSON.stringify({ event: 'bts:pong', data: {} }))
        resetWatchdog()
        return
      }

      if (msg.event !== 'trade') return
      resetWatchdog()

      // Bitstamp uses Pusher protocol — data field may be a JSON string (double-encoded)
      const tradeData: BitstampTrade = typeof msg.data === 'string'
        ? JSON.parse(msg.data) as BitstampTrade
        : msg.data as BitstampTrade
      const { price, amount, timestamp } = tradeData
      onTrade(Number(price), Number(amount), Number(timestamp))
    } catch {
      // ignore parse errors
    }
  })

  ws.on('close', () => {
    if (watchdog) clearTimeout(watchdog)
    console.log(`[bitstamp] disconnected, reconnecting in ${RECONNECT_DELAY}ms`)
    setTimeout(connect, RECONNECT_DELAY)
  })

  ws.on('error', (err) => {
    console.error('[bitstamp] error:', err.message)
    ws.terminate()
  })
}

function seedFromDb(): void {
  try {
    const rows = db.prepare(
      `SELECT time, open, high, low, close, volume FROM candles ORDER BY time DESC LIMIT ${MAX_CANDLES}`
    ).all() as Omit<Candle, 'isComplete'>[]
    if (!rows.length) return
    completedCandles.length = 0
    for (const r of rows.reverse()) completedCandles.push({ ...r, isComplete: true })
    console.log(`[bitstamp] seeded ${completedCandles.length} candles from SQLite`)
  } catch (err) {
    console.error('[bitstamp] db seed error:', err)
  }
}

async function fetchHistoricalCandles(attempt = 1): Promise<void> {
  const MAX_ATTEMPTS = 6
  const BACKOFF_MS   = [0, 2000, 4000, 8000, 16000, 32000]

  if (attempt > 1) {
    const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]
    console.log(`[bitstamp] historical retry ${attempt}/${MAX_ATTEMPTS} in ${delay / 1000}s…`)
    await new Promise((r) => setTimeout(r, delay))
  }

  try {
    const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=${CANDLE_SECONDS}&limit=200`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json() as {
      data?: { ohlc?: Array<{ timestamp: string; open: string; high: string; low: string; close: string; volume: string }> }
    }
    const bars = json.data?.ohlc
    if (!Array.isArray(bars)) throw new Error('unexpected response shape')

    // Merge into completedCandles (keep any live candles already added)
    const existingTimes = new Set(completedCandles.map((c) => c.time))
    for (const bar of bars) {
      const t = parseInt(bar.timestamp)
      if (existingTimes.has(t)) continue
      existingTimes.add(t)
      completedCandles.push({
        time: t, open: parseFloat(bar.open), high: parseFloat(bar.high),
        low: parseFloat(bar.low), close: parseFloat(bar.close),
        volume: parseFloat(bar.volume), isComplete: true,
      })
    }
    completedCandles.sort((a, b) => a.time - b.time)
    if (completedCandles.length > MAX_CANDLES)
      completedCandles.splice(0, completedCandles.length - MAX_CANDLES)

    // Persist to DB
    const insertMany = db.transaction((candles: Candle[]) => {
      for (const c of candles) try { insertCandle.run(c) } catch { /* ignore */ }
    })
    insertMany(completedCandles)
    console.log(`[bitstamp] loaded ${completedCandles.length} historical candles`)
  } catch (err) {
    console.error(`[bitstamp] historical fetch error (attempt ${attempt}):`, err)
    if (attempt < MAX_ATTEMPTS) {
      fetchHistoricalCandles(attempt + 1).catch(() => {/* background retry */})
    } else {
      console.error('[bitstamp] giving up on historical backfill after max retries')
    }
  }
}

export async function startBitstampClient() {
  seedFromDb()              // instant — populates chart immediately from DB
  fetchHistoricalCandles()  // async — retries in background until it succeeds
  connect()
}

export function getCandles(limit: number): Candle[] {
  const liveTime = currentCandle?.time ?? -1
  const deduped = completedCandles.filter((c) => c.time !== liveTime)
  const all = currentCandle ? [...deduped, { ...currentCandle }] : deduped
  return all.slice(-limit)
}

export function getCurrentCandle(): Candle | null {
  return currentCandle ? { ...currentCandle } : null
}

export const bitstampEmitter = emitter
