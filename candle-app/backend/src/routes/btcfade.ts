import { Router } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()

const BINANCE_URL = 'https://api.binance.com/api/v3/klines'
const JOURNAL_PATH = process.env.JOURNAL_PATH
  ?? path.resolve('E:/Projects/vibecoding/claude/btcbacktest/data/fade_journal.jsonl')

function colour(open: number, close: number): 'green' | 'red' | 'doji' {
  if (close > open) return 'green'
  if (close < open) return 'red'
  return 'doji'
}

interface Candle { time: number; open: number; high: number; low: number; close: number }
interface Signal  { time: number; type: 'S4' | 'S5'; direction: 'UP' | 'DOWN'; streakColour: 'green' | 'red' }

function computeSignals(candles: Candle[]): Signal[] {
  const signals: Signal[] = []
  const seen = new Set<number>()   // deduplicate by candle time

  // p = index of prediction candle (c6); signal fires on close of p-1 (c5)
  for (let p = 5; p < candles.length; p++) {
    const c5 = candles[p - 1]
    const col = colour(c5.open, c5.close)
    if (col === 'doji') continue

    const matchCol = (j: number) => colour(candles[j].open, candles[j].close) === col

    // S5: c1..c5 all same colour (indices p-5 .. p-1)
    const isS5 = p >= 6 && matchCol(p-5) && matchCol(p-4) && matchCol(p-3) && matchCol(p-2) && matchCol(p-1)
    // S4: c2..c5 same colour (indices p-4 .. p-1)
    const isS4 = matchCol(p-4) && matchCol(p-3) && matchCol(p-2) && matchCol(p-1)

    if ((isS5 || isS4) && !seen.has(c5.time)) {
      seen.add(c5.time)
      signals.push({
        time:        c5.time,               // marker on the last streak candle
        type:        isS5 ? 'S5' : 'S4',
        direction:   col === 'green' ? 'DOWN' : 'UP',
        streakColour: col,
      })
    }
  }
  return signals
}

// ── GET /api/btcfade/candles ─────────────────────────────────────────────────
router.get('/candles', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 200), 500)
    const fetchCount = limit + 8   // extra candles for streak look-back

    const resp = await fetch(
      `${BINANCE_URL}?symbol=BTCUSDT&interval=15m&limit=${fetchCount}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    const rows = (await resp.json()) as unknown[][]
    const nowMs = Date.now()

    const closed: Candle[] = rows
      .filter((r) => Number(r[6]) < nowMs)
      .map((r) => ({
        time:  Math.floor(Number(r[0]) / 1000),
        open:  Number(r[1]),
        high:  Number(r[2]),
        low:   Number(r[3]),
        close: Number(r[4]),
      }))

    // Current live streak (on the in-progress candle)
    const latestClosed = closed[closed.length - 1]
    const streakCol = colour(latestClosed.open, latestClosed.close)
    let streakLen = 0
    if (streakCol !== 'doji') {
      streakLen = 1
      for (let i = closed.length - 2; i >= 0; i--) {
        if (colour(closed[i].open, closed[i].close) === streakCol) streakLen++
        else break
      }
    }

    const signals = computeSignals(closed)

    res.json({
      candles: closed.slice(-limit),
      signals,
      streak: { length: streakLen, colour: streakCol },
    })
  } catch (e) {
    console.error('[btcfade] candles error:', e)
    res.status(500).json({ error: String(e) })
  }
})

// ── GET /api/btcfade/journal ─────────────────────────────────────────────────
router.get('/journal', (_req, res) => {
  try {
    if (!fs.existsSync(JOURNAL_PATH)) {
      return res.json({ records: [], stats: emptyStats() })
    }

    const lines = fs.readFileSync(JOURNAL_PATH, 'utf-8')
      .trim().split('\n').filter(Boolean)
    const records = lines
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
      .reverse()   // newest first

    res.json({ records, stats: buildStats(records) })
  } catch (e) {
    console.error('[btcfade] journal error:', e)
    res.status(500).json({ error: String(e) })
  }
})

function emptyStats() {
  return { total: 0, wins: 0, losses: 0, win_rate: 0, pnl_100: 0,
           s4_total: 0, s4_wins: 0, s4_wr: 0,
           s5_total: 0, s5_wins: 0, s5_wr: 0,
           sessions: {}, wr_7d: null, wr_30d: null }
}

function buildStats(records: any[]) {
  const resolved = records.filter((r) => r.result === 'WIN' || r.result === 'LOSS')
  const total  = resolved.length
  const wins   = resolved.filter((r) => r.result === 'WIN').length
  const losses = total - wins

  const s4 = resolved.filter((r) => String(r.strategy).includes('S4'))
  const s5 = resolved.filter((r) => String(r.strategy).includes('S5'))

  const sessions: Record<string, { total: number; wins: number; wr: number }> = {}
  for (const r of resolved) {
    const s = r.session ?? '?'
    if (!sessions[s]) sessions[s] = { total: 0, wins: 0, wr: 0 }
    sessions[s].total++
    if (r.result === 'WIN') sessions[s].wins++
  }
  for (const s of Object.keys(sessions)) {
    sessions[s].wr = sessions[s].total
      ? +((sessions[s].wins / sessions[s].total) * 100).toFixed(1)
      : 0
  }

  const now = new Date().toISOString()
  const wr7d  = wrWindow(resolved, 7,  now)
  const wr30d = wrWindow(resolved, 30, now)

  return {
    total, wins, losses,
    win_rate: total ? +((wins / total) * 100).toFixed(1) : 0,
    pnl_100:  (wins - losses) * 100,
    s4_total: s4.length,
    s4_wins:  s4.filter((r) => r.result === 'WIN').length,
    s4_wr:    s4.length ? +((s4.filter((r) => r.result === 'WIN').length / s4.length) * 100).toFixed(1) : 0,
    s5_total: s5.length,
    s5_wins:  s5.filter((r) => r.result === 'WIN').length,
    s5_wr:    s5.length ? +((s5.filter((r) => r.result === 'WIN').length / s5.length) * 100).toFixed(1) : 0,
    sessions,
    wr_7d:  wr7d,
    wr_30d: wr30d,
  }
}

function wrWindow(resolved: any[], days: number, now: string): number | null {
  const cutoff = new Date(new Date(now).getTime() - days * 86400e3).toISOString()
  const w = resolved.filter((r) => r.signal_time >= cutoff)
  if (!w.length) return null
  const ww = w.filter((r) => r.result === 'WIN').length
  return +((ww / w.length) * 100).toFixed(1)
}

export default router
