import { Router, type Request, type Response } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { getMarketCache, getOddsHistory } from './polymarket'
import { getWindowState } from '../signals/window'
import { getCurrentSession } from '../utils/sessions'
import { getNewsCache } from './news'
import { db } from '../db/index'
import { getSettings } from './settings'

const router = Router()

function buildContext(): string {
  const market = getMarketCache()
  const ws = getWindowState()
  const session = getCurrentSession(Math.floor(Date.now() / 1000))
  const news = getNewsCache()
  const oddsHistory = getOddsHistory()

  // Today's trades
  const today = new Date().toISOString().slice(0, 10)
  const trades = db.prepare(`
    SELECT direction, candle_num, btc_price, odds_up, payout, outcome, pnl, session, body_pct_prev, pct_from_c1, signal_score, created_at
    FROM trades WHERE DATE(created_at) = ? ORDER BY created_at DESC LIMIT 20
  `).all(today) as Array<Record<string, unknown>>

  const tradeStats = db.prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      ROUND(COALESCE(SUM(pnl),0),2) as net_pnl
    FROM trades WHERE DATE(created_at) = ?
  `).get(today) as Record<string, number>

  // Recent journal entries
  const journal = db.prepare(`
    SELECT entry_type, text, created_at, candle_num, session, odds_up, pct_from_c1, trade_id
    FROM journal_entries ORDER BY created_at DESC LIMIT 15
  `).all() as Array<Record<string, unknown>>

  // Historical config win rate (current session + candle_num)
  const configWinRate = ws.candleNum > 0 && session !== 'off'
    ? db.prepare(`
        SELECT COUNT(*) as total,
          ROUND(100.0*SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) as win_rate
        FROM trades WHERE outcome IS NOT NULL AND session = ? AND candle_num = ?
      `).get(session, ws.candleNum) as { total: number; win_rate: number } | null
    : null

  const lines: string[] = [
    '=== LIVE MARKET CONTEXT ===',
    `BTC Price: $${ws.windowClose?.toFixed(0) ?? 'unknown'}`,
    `Session: ${session.toUpperCase()}`,
    `Candle: C${ws.candleNum}/5`,
    `% from C1 Open: ${ws.pctFromC1?.toFixed(3) ?? 0}%`,
    `Prev Window Body%: ${ws.prevWindowBodyPct?.toFixed(1) ?? 0}%`,
    `Prev Window Direction: ${ws.prevWindowDirection ?? 'unknown'}`,
    '',
    '=== POLYMARKET ODDS ===',
  ]

  if (market) {
    lines.push(`Market: ${market.slug}`)
    lines.push(`UP: ${Math.round(market.oddsUp * 100)}% (${market.payoutUp.toFixed(2)}x payout)`)
    lines.push(`DOWN: ${Math.round(market.oddsDown * 100)}% (${market.payoutDown.toFixed(2)}x payout)`)
    lines.push(`Volume: $${(market.volume / 1000).toFixed(1)}k | Liquidity: $${(market.liquidity / 1000).toFixed(1)}k`)
    lines.push(`Window ends: ${market.endTime}`)
  } else {
    lines.push('Market data unavailable')
  }

  if (oddsHistory.length > 0) {
    lines.push('')
    lines.push('Odds drift this window:')
    for (const snap of oddsHistory) {
      lines.push(`  C${snap.candleNum}: UP ${Math.round(snap.oddsUp * 100)}% / DN ${Math.round(snap.oddsDown * 100)}%`)
    }
  }

  if (configWinRate && configWinRate.total > 0) {
    lines.push('')
    lines.push(`Historical win rate (${session} session, C${ws.candleNum} entry): ${configWinRate.win_rate}% from ${configWinRate.total} trades`)
  }

  lines.push('')
  lines.push('=== TODAY\'S TRADES ===')
  if (trades.length === 0) {
    lines.push('No trades today')
  } else {
    const winRate = tradeStats.wins + tradeStats.losses > 0
      ? Math.round(tradeStats.wins / (tradeStats.wins + tradeStats.losses) * 100)
      : 0
    lines.push(`Today: ${tradeStats.total} trades | ${tradeStats.wins}W/${tradeStats.losses}L | Win rate: ${winRate}% | Net P&L: ${tradeStats.net_pnl >= 0 ? '+' : ''}${tradeStats.net_pnl}`)
    lines.push('')
    for (const t of trades.slice(0, 10)) {
      const pnlStr = t.outcome
        ? `${t.outcome} ${t.pnl != null ? (Number(t.pnl) >= 0 ? '+' : '') + Number(t.pnl).toFixed(2) : ''}`
        : 'OPEN'
      lines.push(`  ${t.direction} @$${Number(t.btc_price).toFixed(0)} C${t.candle_num} ${t.session ?? ''} | ${pnlStr}`)
    }
  }

  if (news.length > 0) {
    lines.push('')
    lines.push('=== RECENT NEWS ===')
    for (const n of news) {
      lines.push(`  [${n.impact}/${n.sentiment}] ${n.headline}`)
    }
  }

  if (journal.length > 0) {
    lines.push('')
    lines.push('=== RECENT JOURNAL ENTRIES ===')
    for (const e of journal) {
      const ts = new Date(e.created_at as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      lines.push(`  [${ts}] [${e.entry_type}] ${e.text}`)
    }
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are an expert BTC trading assistant integrated into a real-time Polymarket trading terminal.

You have access to live market data injected at the start of every message: BTC price, candlestick window state, Polymarket odds, historical win rates, today's trade log, and the user's journal entries.

Your job:
- Help the user analyze the current market setup
- Synthesize signals: body%, session, odds drift, % from C1, fib levels, news
- Reference their own historical win rate data when relevant
- Help them decide whether to trade UP or DOWN (or wait)
- Analyze patterns in their past trades and journal
- Answer questions about position sizing, Kelly criterion, session patterns

Guidelines:
- Be concise — this is a trading terminal, not a blog post
- Lead with the actionable insight
- Use numbers from the context (actual odds, prices, win rates)
- If data is unavailable, say so rather than guessing
- Never give financial advice in the legal sense; frame as analysis`

// POST /api/ai/chat — streaming SSE
router.post('/chat', async (req: Request, res: Response) => {
  const { message, history = [] } = req.body as {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) {
    res.status(400).json({ error: 'message required' })
    return
  }

  const settings = getSettings()
  const apiKey = settings.claudeApiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'Claude API key not configured. Add it in Settings.' })
    return
  }

  const contextBlock = buildContext()

  // Build messages: inject context as the first user message if history is empty,
  // or prepend to current message
  const contextPrefix = `[LIVE CONTEXT]\n${contextBlock}\n\n[USER MESSAGE]\n`

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history.slice(-20), // keep last 20 exchanges
    { role: 'user', content: `${contextPrefix}${message}` },
  ]

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const client = new Anthropic({ apiKey })

    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`)
      }
    }

    const finalMsg = await stream.finalMessage()
    const fullResponse = finalMsg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')

    res.write(`data: ${JSON.stringify({ done: true, fullResponse })}\n\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ai] streaming error:', msg)
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
  } finally {
    res.end()
  }
})

// GET /api/ai/context — returns what would be injected
router.get('/context', (_req, res) => {
  const market = getMarketCache()
  const ws = getWindowState()
  const session = getCurrentSession(Math.floor(Date.now() / 1000))
  const news = getNewsCache()
  const today = new Date().toISOString().slice(0, 10)

  const tradeCount = (db.prepare('SELECT COUNT(*) as n FROM trades WHERE DATE(created_at) = ?').get(today) as { n: number }).n
  const journalCount = (db.prepare('SELECT COUNT(*) as n FROM journal_entries').get() as { n: number }).n

  res.json({
    price: ws.windowClose,
    candleNum: ws.candleNum,
    session,
    oddsUp: market?.oddsUp,
    oddsDown: market?.oddsDown,
    bodyPctPrev: ws.prevWindowBodyPct,
    pctFromC1: ws.pctFromC1,
    newsCount: news.length,
    tradesLoaded: tradeCount,
    journalEntriesLoaded: journalCount,
  })
})

// POST /api/ai/proactive — auto-analysis at C4
router.post('/proactive', async (req: Request, res: Response) => {
  const settings = getSettings()
  const apiKey = settings.claudeApiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'Claude API key not configured' })
    return
  }

  const contextBlock = buildContext()
  const proactivePrompt = `[LIVE CONTEXT]\n${contextBlock}\n\n[USER MESSAGE]\nProvide a brief proactive trading analysis for the current setup. Be very concise (2-4 sentences). Include: setup strength, key signals, and a clear UP or DOWN lean if signals are clear. If mixed/weak, say so.`

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: proactivePrompt }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`)
      }
    }

    const finalMsg = await stream.finalMessage()
    const fullResponse = finalMsg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')

    res.write(`data: ${JSON.stringify({ done: true, fullResponse })}\n\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
  } finally {
    res.end()
  }
})

export default router
