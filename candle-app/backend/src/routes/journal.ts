import { Router } from 'express'
import { db } from '../db/index'
import { getMarketCache } from './polymarket'
import { getWindowState } from '../signals/window'

const router = Router()

// POST /api/journal
router.post('/', (req, res) => {
  const { entryType = 'note', text, tags = [], tradeId, chartScreenshot } = req.body as {
    entryType?: 'note' | 'trade_note' | 'setup' | 'review'
    text: string
    tags?: string[]
    tradeId?: number
    chartScreenshot?: string
  }

  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return }

  const market = getMarketCache()
  const ws = getWindowState()

  const stmt = db.prepare(`
    INSERT INTO journal_entries
      (entry_type, text, tags, btc_price, candle_num, session, odds_up, odds_down,
       signal_score, pct_from_c1, body_pct_prev, chart_screenshot, trade_id)
    VALUES
      (@entry_type, @text, @tags, @btc_price, @candle_num, @session, @odds_up, @odds_down,
       @signal_score, @pct_from_c1, @body_pct_prev, @chart_screenshot, @trade_id)
  `)

  const info = stmt.run({
    entry_type: entryType,
    text: text.trim(),
    tags: tags.length ? JSON.stringify(tags) : null,
    btc_price: ws.windowClose ?? null,
    candle_num: ws.candleNum ?? null,
    session: null,
    odds_up: market?.oddsUp ?? null,
    odds_down: market?.oddsDown ?? null,
    signal_score: null,
    pct_from_c1: ws.pctFromC1 ?? null,
    body_pct_prev: ws.prevWindowBodyPct ?? null,
    chart_screenshot: chartScreenshot ?? null,
    trade_id: tradeId ?? null,
  })

  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(info.lastInsertRowid)
  res.status(201).json(entry)
})

// GET /api/journal
router.get('/', (req, res) => {
  const { date, entryType, limit = 100, tag } = req.query as Record<string, string>

  let where = '1=1'
  const params: Record<string, unknown> = {}

  if (date) { where += ' AND DATE(created_at) = @date'; params.date = date }
  if (entryType) { where += ' AND entry_type = @entryType'; params.entryType = entryType }
  if (tag) { where += " AND tags LIKE @tag"; params.tag = `%"${tag}"%` }

  const entries = db.prepare(`
    SELECT je.*, t.outcome as trade_outcome, t.direction as trade_direction, t.pnl as trade_pnl
    FROM journal_entries je
    LEFT JOIN trades t ON je.trade_id = t.id
    WHERE ${where}
    ORDER BY je.created_at DESC
    LIMIT @limit
  `).all({ ...params, limit: Number(limit) })

  // Parse tags JSON
  const parsed = (entries as Array<Record<string, unknown>>).map((e) => ({
    ...e,
    tags: e.tags ? JSON.parse(e.tags as string) : [],
  }))

  // Stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_this_month,
      COUNT(DISTINCT DATE(created_at)) as days_logged
    FROM journal_entries
    WHERE DATE(created_at) >= DATE('now','start of month')
  `).get()

  const topTags = db.prepare(`
    SELECT json_each.value as tag, COUNT(*) as count
    FROM journal_entries, json_each(journal_entries.tags)
    WHERE DATE(created_at) >= DATE('now','-30 days')
    GROUP BY tag ORDER BY count DESC LIMIT 10
  `).all()

  res.json({ entries: parsed, stats, topTags })
})

// GET /api/journal/calendar — heatmap data
router.get('/calendar', (req, res) => {
  const { year, month } = req.query as { year?: string; month?: string }
  const y = year ?? new Date().getFullYear().toString()
  const m = month ? month.padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0')

  const days = db.prepare(`
    SELECT
      DATE(t.created_at) as date,
      ROUND(COALESCE(SUM(t.pnl),0),2) as net_pnl,
      COUNT(t.id) as trades,
      MAX(CASE WHEN je.id IS NOT NULL THEN 1 ELSE 0 END) as has_journal
    FROM trades t
    LEFT JOIN journal_entries je ON DATE(je.created_at) = DATE(t.created_at)
    WHERE strftime('%Y',t.created_at)=@year AND strftime('%m',t.created_at)=@month
    GROUP BY DATE(t.created_at)
    ORDER BY date
  `).all({ year: y, month: m })

  res.json({ days })
})

export default router
