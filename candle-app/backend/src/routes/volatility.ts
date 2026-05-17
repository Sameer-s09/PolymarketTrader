import { Router } from 'express'
import { db } from '../db/index'

const router = Router()

// ── Types ─────────────────────────────────────────────────────────────────────
export interface HourStats {
  hour:         number   // 0–23 UTC
  maxCandle:    number   // max individual candle body %
  avgCandle:    number   // avg individual candle body %
  maxWindow:    number   // max 15-min window move %
  avgWindow:    number   // avg 15-min window move %
  candleCount:  number
  windowCount:  number
}

// ── GET /api/volatility/profile ───────────────────────────────────────────────
// Returns max/avg candle body % and max/avg 15-min window % grouped by UTC hour.
router.get('/profile', (_req, res) => {
  try {
    // ── Per-candle stats by UTC hour ──────────────────────────────────────────
    const candleRows = db.prepare(`
      SELECT
        CAST(strftime('%H', datetime(time, 'unixepoch')) AS INTEGER) AS hour,
        MAX(ABS((close - open) / open) * 100) AS max_candle,
        AVG(ABS((close - open) / open) * 100) AS avg_candle,
        COUNT(*) AS candle_count
      FROM candles
      WHERE open > 0
      GROUP BY hour
      ORDER BY hour
    `).all() as { hour: number; max_candle: number; avg_candle: number; candle_count: number }[]

    // ── 15-min window stats by UTC hour ──────────────────────────────────────
    // Join each window's first and last candle to get win_open and win_close.
    const windowRows = db.prepare(`
      WITH win_bounds AS (
        SELECT
          (time / 900) * 900              AS win_start,
          MIN(time)                        AS first_time,
          MAX(time)                        AS last_time,
          COUNT(*)                         AS n_candles
        FROM candles
        GROUP BY win_start
        HAVING n_candles >= 3
      )
      SELECT
        CAST(strftime('%H', datetime(wb.win_start, 'unixepoch')) AS INTEGER) AS hour,
        MAX(ABS((cn.close - c1.open) / c1.open) * 100) AS max_win,
        AVG(ABS((cn.close - c1.open) / c1.open) * 100) AS avg_win,
        COUNT(*) AS win_count
      FROM win_bounds wb
      JOIN candles c1 ON c1.time = wb.first_time
      JOIN candles cn ON cn.time = wb.last_time
      WHERE c1.open > 0
      GROUP BY hour
      ORDER BY hour
    `).all() as { hour: number; max_win: number; avg_win: number; win_count: number }[]

    // ── Merge into 24-slot array ──────────────────────────────────────────────
    const candleMap = new Map(candleRows.map((r) => [r.hour, r]))
    const windowMap = new Map(windowRows.map((r) => [r.hour, r]))

    const profile: HourStats[] = Array.from({ length: 24 }, (_, h) => {
      const c = candleMap.get(h)
      const w = windowMap.get(h)
      return {
        hour:        h,
        maxCandle:   c ? Number(c.max_candle.toFixed(4)) : 0,
        avgCandle:   c ? Number(c.avg_candle.toFixed(4)) : 0,
        maxWindow:   w ? Number(w.max_win.toFixed(4))    : 0,
        avgWindow:   w ? Number(w.avg_win.toFixed(4))    : 0,
        candleCount: c?.candle_count ?? 0,
        windowCount: w?.win_count ?? 0,
      }
    })

    const totalCandles = candleRows.reduce((s, r) => s + r.candle_count, 0)
    res.json({ profile, totalCandles })
  } catch (err) {
    console.error('[volatility] profile error:', err)
    res.status(500).json({ error: 'Failed to compute profile' })
  }
})

// ── POST /api/volatility/backfill ─────────────────────────────────────────────
// Fetches historical 3-min OHLC from Bitstamp REST API and upserts into DB.
// Body: { days?: number }  (default 30, max 90)
router.post('/backfill', async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.body?.days ?? 30)))
  const STEP  = 180   // 3-min candles
  const LIMIT = 1000  // max per Bitstamp call
  const now   = Math.floor(Date.now() / 1000)
  const start = now - days * 86400

  const insert = db.prepare(`
    INSERT OR REPLACE INTO candles (time, open, high, low, close, volume)
    VALUES (@time, @open, @high, @low, @close, @volume)
  `)
  const insertMany = db.transaction((rows: Array<{ time:number; open:number; high:number; low:number; close:number; volume:number }>) => {
    for (const r of rows) insert.run(r)
  })

  let fetched = 0
  let cursor  = start
  let pages   = 0
  const MAX_PAGES = 100

  try {
    while (cursor < now - STEP && pages < MAX_PAGES) {
      const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=${STEP}&limit=${LIMIT}&start=${cursor}`
      const apiRes = await fetch(url)
      if (!apiRes.ok) break

      const json = await apiRes.json() as {
        data?: { ohlc?: Array<{ timestamp: string; open: string; high: string; low: string; close: string; volume: string }> }
      }
      const bars = json.data?.ohlc
      if (!Array.isArray(bars) || bars.length === 0) break

      const rows = bars.map((b) => ({
        time:   parseInt(b.timestamp),
        open:   parseFloat(b.open),
        high:   parseFloat(b.high),
        low:    parseFloat(b.low),
        close:  parseFloat(b.close),
        volume: parseFloat(b.volume),
      }))

      insertMany(rows)
      fetched += rows.length
      cursor = rows[rows.length - 1].time + STEP
      pages++

      // Bitstamp rate-limit: be polite, small pause between pages
      if (pages < MAX_PAGES && cursor < now - STEP) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    // Report how many candles are now in the DB
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM candles').get() as { count: number }
    console.log(`[volatility] backfill done: fetched=${fetched} pages=${pages} total_in_db=${count}`)
    res.json({ ok: true, fetched, pages, totalInDb: count })
  } catch (err) {
    console.error('[volatility] backfill error:', err)
    res.status(500).json({ error: 'Backfill failed', fetched })
  }
})

// ── GET /api/volatility/db-stats ──────────────────────────────────────────────
router.get('/db-stats', (_req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MIN(time) AS oldest, MAX(time) AS newest
    FROM candles
  `).get() as { count: number; oldest: number | null; newest: number | null }
  res.json({
    count:   row.count,
    oldest:  row.oldest  ? new Date(row.oldest  * 1000).toISOString() : null,
    newest:  row.newest  ? new Date(row.newest  * 1000).toISOString() : null,
    days:    row.oldest && row.newest ? Math.round((row.newest - row.oldest) / 86400) : 0,
  })
})

export default router
