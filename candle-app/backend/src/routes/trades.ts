import { Router } from 'express'
import { db } from '../db/index'
import { getMarketCache } from './polymarket'
import { getWindowState } from '../signals/window'

const router = Router()

// POST /api/trades — capture a mock trade
router.post('/', (req, res) => {
  const { direction, stake = 5, notes } = req.body as {
    direction: 'UP' | 'DOWN'
    stake?: number
    notes?: string
  }

  if (!direction || !['UP', 'DOWN'].includes(direction)) {
    res.status(400).json({ error: 'direction must be UP or DOWN' })
    return
  }

  const market = getMarketCache()
  if (!market) {
    res.status(503).json({ error: 'No active market', code: 'NO_ACTIVE_MARKET' })
    return
  }

  const ws = getWindowState()
  const payout = direction === 'UP' ? market.payoutUp : market.payoutDown

  const stmt = db.prepare(`
    INSERT INTO trades
      (direction, stake, odds_up, odds_down, payout, market_slug, market_end_time,
       candle_num, btc_price, pct_from_c1, body_pct_prev, signal_score, c1_open, session, notes)
    VALUES
      (@direction, @stake, @odds_up, @odds_down, @payout, @market_slug, @market_end_time,
       @candle_num, @btc_price, @pct_from_c1, @body_pct_prev, @signal_score, @c1_open, @session, @notes)
  `)

  const info = stmt.run({
    direction,
    stake,
    odds_up: market.oddsUp,
    odds_down: market.oddsDown,
    payout,
    market_slug: market.slug,
    market_end_time: market.endTime,
    candle_num: ws.candleNum,
    btc_price: ws.windowClose,
    pct_from_c1: ws.pctFromC1,
    body_pct_prev: ws.prevWindowBodyPct,
    signal_score: null,
    c1_open: ws.c1Open,
    session: null,
    notes: notes ?? null,
  })

  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid)
  console.log(`[trades] new ${direction} @${ws.windowClose?.toFixed(0)} stake=${stake}`)
  res.status(201).json(trade)
})

// GET /api/trades — list trades with stats
router.get('/', (req, res) => {
  const { date, limit = 100, outcome } = req.query as Record<string, string>
  const dateFilter = date ?? new Date().toISOString().slice(0, 10)

  let where = "WHERE DATE(created_at) = @date"
  const params: Record<string, unknown> = { date: dateFilter }
  if (outcome) { where += " AND outcome = @outcome"; params.outcome = outcome }

  const trades = db.prepare(`
    SELECT * FROM trades ${where}
    ORDER BY created_at DESC LIMIT @limit
  `).all({ ...params, limit: Number(limit) })

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN outcome IS NULL THEN 1 ELSE 0 END) as open,
      ROUND(COALESCE(SUM(pnl),0),2) as net_pnl
    FROM trades WHERE DATE(created_at) = @date
  `).get({ date: dateFilter }) as { total: number; wins: number; losses: number; open: number; net_pnl: number }

  const winRate = stats.wins + stats.losses > 0
    ? Math.round(stats.wins / (stats.wins + stats.losses) * 100)
    : 0

  res.json({ trades, stats: { ...stats, win_rate: winRate } })
})

// GET /api/trades/analytics
router.get('/analytics', (_req, res) => {
  const byCandleNum = db.prepare(`
    SELECT candle_num, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      ROUND(100.0*SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END)/COUNT(*),1) as win_rate
    FROM trades WHERE outcome IS NOT NULL
    GROUP BY candle_num ORDER BY candle_num
  `).all()

  const bySession = db.prepare(`
    SELECT session, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      ROUND(100.0*SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END)/COUNT(*),1) as win_rate,
      ROUND(SUM(pnl),2) as total_pnl
    FROM trades WHERE outcome IS NOT NULL AND session IS NOT NULL
    GROUP BY session
  `).all()

  const allTime = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      ROUND(100.0*SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) as win_rate,
      ROUND(COALESCE(SUM(pnl),0),2) as total_pnl
    FROM trades WHERE outcome IS NOT NULL
  `).get()

  const byBodyPct = db.prepare(`
    SELECT
      CASE
        WHEN body_pct_prev >= 70 THEN '>70%'
        WHEN body_pct_prev >= 50 THEN '50-70%'
        ELSE '<50%'
      END as bucket,
      COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      ROUND(100.0*SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END)/COUNT(*),1) as win_rate
    FROM trades WHERE outcome IS NOT NULL AND body_pct_prev IS NOT NULL
    GROUP BY bucket ORDER BY bucket DESC
  `).all()

  // Virtual balance: start 100 + all resolved pnl
  const virtualBalance = db.prepare(`
    SELECT ROUND(100 + COALESCE(SUM(pnl), 0), 2) as balance FROM trades WHERE outcome IS NOT NULL
  `).get() as { balance: number }

  res.json({ byCandleNum, bySession, byBodyPct, allTime, virtualBalance: virtualBalance.balance })
})

// POST /api/trades/:id/resolve
router.post('/:id/resolve', (req, res) => {
  const { outcome, resolutionPrice } = req.body as { outcome: 'WIN' | 'LOSS'; resolutionPrice: number }
  const id = Number(req.params.id)
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as Record<string, unknown> | undefined

  if (!trade) { res.status(404).json({ error: 'Trade not found' }); return }

  const pnl = outcome === 'WIN'
    ? Number(trade.stake) * (Number(trade.payout) - 1)
    : -Number(trade.stake)

  db.prepare(`
    UPDATE trades SET outcome=@outcome, pnl=@pnl, resolution_price=@resolutionPrice,
      resolved_at=datetime('now') WHERE id=@id
  `).run({ outcome, pnl: Math.round(pnl * 100) / 100, resolutionPrice, id })

  res.json(db.prepare('SELECT * FROM trades WHERE id = ?').get(id))
})

// Auto-resolve open trades at window close
export function resolveOpenTrades(windowClose: number, direction: 'UP' | 'DOWN') {
  const open = db.prepare(
    "SELECT * FROM trades WHERE outcome IS NULL"
  ).all() as Array<Record<string, unknown>>

  for (const trade of open) {
    const won = trade.direction === direction
    const outcome = won ? 'WIN' : 'LOSS'
    const pnl = won
      ? Number(trade.stake) * (Number(trade.payout) - 1)
      : -Number(trade.stake)

    db.prepare(`
      UPDATE trades SET outcome=@outcome, pnl=@pnl, resolution_price=@rp,
        resolved_at=datetime('now') WHERE id=@id
    `).run({ outcome, pnl: Math.round(pnl * 100) / 100, rp: windowClose, id: trade.id })

    console.log(`[trades] resolved #${trade.id} ${trade.direction} → ${outcome} P&L=${pnl.toFixed(2)}`)
  }
}

export default router
