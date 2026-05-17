import { Router } from 'express'
import WebSocket from 'ws'

const router = Router()

export interface MarketData {
  slug: string
  question: string
  oddsUp: number
  oddsDown: number
  payoutUp: number
  payoutDown: number
  volume: number
  liquidity: number
  endTime: string
  startTime: string
  active: boolean
  closed: boolean
  lastUpdated: string
}

let marketCache: MarketData | null = null
let cacheTimestamp = 0

const POLYMARKET_BASE = 'https://gamma-api.polymarket.com'
const CLOB_BASE = 'https://clob.polymarket.com'
const CLOB_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Origin': 'https://polymarket.com',
  'Accept': 'application/json',
}

let activeTokenIds: [string, string] | null = null
let activeMarketMeta: Omit<MarketData, 'oddsUp' | 'oddsDown' | 'payoutUp' | 'payoutDown' | 'lastUpdated'> | null = null

// ── CLOB WebSocket for real-time prices ───────────────────────────────────────
let clobWs: WebSocket | null = null
let wsSubscribedTokens: [string, string] | null = null

// Track BID (BUY) and ASK (SELL) prices separately.
// BID prices represent what buyers are actually willing to pay → true market probability.
// ASK prices (from market makers placing initial orders) can be extreme (0.99/0.01) and
// should not be used on their own to derive odds.
const wsBidPrices: Record<string, number> = {}   // BUY side (most reliable)
const wsAskPrices: Record<string, number> = {}   // SELL side (fallback only)
let wsConnected = false

function applyWsPrices() {
  if (!activeMarketMeta || !wsSubscribedTokens) return
  const [upToken, downToken] = wsSubscribedTokens

  // Prefer BID prices (what buyers pay = true probability).
  // Fall back to ASK if no BID exists yet for that token.
  // Never mix BID for one token with ASK for the other — that's the source of 99/1 spikes.
  const upHasBid   = wsBidPrices[upToken]   != null
  const downHasBid = wsBidPrices[downToken] != null

  let rawUp: number | undefined
  let rawDown: number | undefined

  if (upHasBid && downHasBid) {
    // Best case: real buyer interest on both sides
    rawUp   = wsBidPrices[upToken]
    rawDown = wsBidPrices[downToken]
  } else if (!upHasBid && !downHasBid) {
    // No bids yet — fall back to ASK prices only if both ASK prices are available
    rawUp   = wsAskPrices[upToken]
    rawDown = wsAskPrices[downToken]
  } else {
    // One side has a bid, the other only has an ask — mixing would distort odds.
    // Use bid where available; for the other side use 1 - bid as implied price.
    if (upHasBid) {
      rawUp   = wsBidPrices[upToken]
      rawDown = 1 - rawUp
    } else {
      rawDown = wsBidPrices[downToken]
      rawUp   = 1 - rawDown
    }
  }

  if (rawUp == null || rawDown == null) return

  // Sanity check: prices must sum close to 1.0
  const sum = rawUp + rawDown
  if (sum < 0.85 || sum > 1.15) return

  // Normalize to exactly 1.0
  const oddsUp   = rawUp   / sum
  const oddsDown = rawDown / sum

  marketCache = {
    ...activeMarketMeta,
    oddsUp,
    oddsDown,
    payoutUp:   oddsUp   > 0 ? Math.round((1 / oddsUp)   * 100) / 100 : 0,
    payoutDown: oddsDown > 0 ? Math.round((1 / oddsDown) * 100) / 100 : 0,
    lastUpdated: new Date().toISOString(),
  }
  cacheTimestamp = Date.now()
}

function seedBidPrices(upToken: string, upPrice: number, downToken: string, downPrice: number) {
  // Seed BID prices from gamma API so display is immediately reasonable
  // before any real buyers place orders on the WS
  wsBidPrices[upToken]   = upPrice
  wsBidPrices[downToken] = downPrice
}

function clearTokenPrices(token: string) {
  delete wsBidPrices[token]
  delete wsAskPrices[token]
}

function connectClobWs(upToken: string, downToken: string) {
  if (clobWs) {
    clobWs.removeAllListeners()
    clobWs.terminate()
    clobWs = null
    wsConnected = false
  }

  // Clear prices for PREVIOUS market tokens only — preserve seeds for new tokens
  if (wsSubscribedTokens) {
    const [oldUp, oldDown] = wsSubscribedTokens
    if (oldUp   !== upToken)   clearTokenPrices(oldUp)
    if (oldDown !== downToken) clearTokenPrices(oldDown)
  }
  wsSubscribedTokens = [upToken, downToken]

  try {
    const ws = new WebSocket(CLOB_WS, { headers: { Origin: 'https://polymarket.com' } })
    clobWs = ws

    ws.on('open', () => {
      wsConnected = true
      console.log(`[clob-ws] connected, subscribing tokens ${upToken.slice(0,8)}…`)
      ws.send(JSON.stringify({
        auth: null,
        type: 'subscribe',
        channel: 'price_change',
        assets_ids: [upToken, downToken],
      }))
    })

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString())
        let updated = false

        const handleEvent = (ev: { asset_id?: string; price?: string; side?: string }) => {
          const tokenId = ev.asset_id
          const price   = parseFloat(ev.price ?? '0')
          const side    = (ev.side ?? '').toUpperCase()
          if (!tokenId || !(price > 0) || !(price < 1)) return
          // Route to the correct price bucket
          if (side === 'BUY')       wsBidPrices[tokenId] = price
          else if (side === 'SELL') wsAskPrices[tokenId] = price
          else {
            // Unknown side — treat as bid (safer than ask for odds display)
            wsBidPrices[tokenId] = price
          }
          updated = true
        }

        // Format A: array [{asset_id, price, side, ...}]
        if (Array.isArray(data)) {
          for (const ev of data as Array<{ asset_id?: string; price?: string; side?: string }>) {
            handleEvent(ev)
          }
        // Format B: {price_changes: [{asset_id, price, side}, ...]}
        } else if (data.price_changes) {
          for (const pc of data.price_changes as Array<{ asset_id?: string; price?: string; side?: string }>) {
            handleEvent(pc)
          }
        }

        if (updated) applyWsPrices()
      } catch {}
    })

    ws.on('close', (code, reason) => {
      wsConnected = false
      clobWs = null
      console.log(`[clob-ws] disconnected code=${code} reason=${reason?.toString()}, reconnecting in 3s…`)
      setTimeout(() => {
        if (wsSubscribedTokens) connectClobWs(wsSubscribedTokens[0], wsSubscribedTokens[1])
      }, 3000)
    })

    ws.on('error', (err) => {
      console.error('[clob-ws] error:', err.message)
      ws.terminate()
    })
  } catch (err) {
    console.error('[clob-ws] failed to connect:', err)
  }
}

// ── Market discovery via gamma API ────────────────────────────────────────────
async function searchActiveMarket(): Promise<{ meta: typeof activeMarketMeta; tokenIds: [string, string] } | null> {
  const base = Math.floor(Math.floor(Date.now() / 1000) / 900) * 900
  const offsets = [0, 900, -900, 1800, -1800, 2700]
  try {
    for (const offset of offsets) {
      const slug = `btc-updown-15m-${base + offset}`
      const res = await fetch(`${POLYMARKET_BASE}/markets?slug=${slug}`, { headers: HEADERS })
      if (!res.ok) continue

      const data = await res.json() as unknown[]
      if (!Array.isArray(data) || data.length === 0) continue

      const market = data[0] as Record<string, unknown>
      if (market.active !== true || market.closed === true) continue

      const tokenIds = JSON.parse(market.clobTokenIds as string) as string[]
      if (!tokenIds || tokenIds.length < 2) continue

      const endTime = String(market.endDate ?? '')
      if (endTime && new Date(endTime).getTime() < Date.now() - 60_000) continue

      const outcomesRaw = market.outcomes
      const outcomes = Array.isArray(outcomesRaw)
        ? outcomesRaw as string[]
        : JSON.parse(outcomesRaw as string) as string[]
      const upIdx = outcomes.findIndex((o) => /up|yes/i.test(o))
      const upTokenId   = upIdx >= 0 ? tokenIds[upIdx] : tokenIds[0]
      const downTokenId = upIdx >= 0 ? tokenIds[1 - upIdx] : tokenIds[1]

      // Seed BID prices from gamma outcomePrices so the UI shows reasonable odds
      // immediately, before any real buyers place orders on the CLOB WS.
      const opRaw = market.outcomePrices
      const op = Array.isArray(opRaw) ? opRaw as string[] : JSON.parse(opRaw as string) as string[]
      if (op?.length >= 2) {
        const upSeed   = parseFloat(upIdx >= 0 ? op[upIdx]       : op[0])
        const downSeed = parseFloat(upIdx >= 0 ? op[1 - upIdx]   : op[1])
        seedBidPrices(upTokenId, upSeed, downTokenId, downSeed)
      }

      console.log(`[polymarket] found: ${slug} (up=${upTokenId.slice(0,8)}…)`)
      return {
        meta: {
          slug,
          question: market.question as string,
          volume: parseFloat(String(market.volume ?? 0)),
          liquidity: parseFloat(String(market.liquidity ?? 0)),
          endTime,
          startTime: (market.startDate as string) ?? '',
          active: true,
          closed: false,
        },
        tokenIds: [upTokenId, downTokenId],
      }
    }
    return null
  } catch (err) {
    console.error('[polymarket] search error:', err)
    return null
  }
}

// ── Gamma outcomePrices polling (fallback when WS has no price yet) ────────────
async function fetchGammaPrices(): Promise<void> {
  if (!activeMarketMeta || !activeTokenIds) return
  try {
    const r = await fetch(`${POLYMARKET_BASE}/markets?slug=${activeMarketMeta.slug}`, { headers: HEADERS })
    if (!r.ok) return
    const d = await r.json() as unknown[]
    if (!Array.isArray(d) || d.length === 0) return
    const m = d[0] as Record<string, unknown>
    const outcomesRaw = m.outcomes
    const outcomes = Array.isArray(outcomesRaw) ? outcomesRaw as string[] : JSON.parse(outcomesRaw as string) as string[]
    const op = Array.isArray(m.outcomePrices) ? m.outcomePrices as string[] : JSON.parse(m.outcomePrices as string) as string[]
    if (!op || op.length < 2) return
    const upIdx = outcomes.findIndex((o: string) => /up|yes/i.test(o))
    const [upToken, downToken] = activeTokenIds
    const gammaUp   = parseFloat(upIdx >= 0 ? op[upIdx]       : op[0])
    const gammaDown = parseFloat(upIdx >= 0 ? op[1 - upIdx]   : op[1])
    // Restore gamma bid-prices if WS bids are missing or the current odds look wrong
    const bidSum = (wsBidPrices[upToken] ?? 0) + (wsBidPrices[downToken] ?? 0)
    if (wsBidPrices[upToken]   == null || bidSum < 0.85 || bidSum > 1.15)
      wsBidPrices[upToken]   = gammaUp
    if (wsBidPrices[downToken] == null || bidSum < 0.85 || bidSum > 1.15)
      wsBidPrices[downToken] = gammaDown
    applyWsPrices()
  } catch {}
}

// ── Refresh loop ──────────────────────────────────────────────────────────────
let metaRefreshAt = 0

async function tick() {
  const marketExpired = activeMarketMeta?.endTime
    ? new Date(activeMarketMeta.endTime).getTime() < Date.now()
    : true

  if (!activeTokenIds || marketExpired || Date.now() - metaRefreshAt > 60_000) {
    const result = await searchActiveMarket()
    if (result) {
      const changed = result.meta?.slug !== activeMarketMeta?.slug
      activeMarketMeta = result.meta
      activeTokenIds = result.tokenIds
      metaRefreshAt = Date.now()
      if (changed) {
        console.log(`[polymarket] market: ${result.meta?.slug}`)
        connectClobWs(result.tokenIds[0], result.tokenIds[1])
      }
    }
  }

  applyWsPrices()
}

export interface OddsSnapshot {
  candleNum: number
  oddsUp: number
  oddsDown: number
  btcPrice: number
  capturedAt: string
}

let oddsHistory: OddsSnapshot[] = []
let lastSnapshotWindow = 0

export function recordOddsSnapshot(candleNum: number, btcPrice: number) {
  if (!marketCache) return
  const windowKey = Math.floor(Date.now() / 900_000)
  if (windowKey !== lastSnapshotWindow) {
    oddsHistory = []
    lastSnapshotWindow = windowKey
  }
  // Update or add snapshot for this candle
  const idx = oddsHistory.findIndex((s) => s.candleNum === candleNum)
  const snap: OddsSnapshot = {
    candleNum,
    oddsUp: marketCache.oddsUp,
    oddsDown: marketCache.oddsDown,
    btcPrice,
    capturedAt: new Date().toISOString(),
  }
  if (idx >= 0) oddsHistory[idx] = snap
  else oddsHistory.push(snap)
}

export function getOddsHistory(): OddsSnapshot[] {
  return [...oddsHistory]
}

export function getMarketCache(): MarketData | null {
  return marketCache
}

// Start: discover market, connect WebSocket, poll gamma every 5s as fallback
tick()
setInterval(tick, 60_000)
setInterval(fetchGammaPrices, 5_000)

router.get('/current', async (_req, res) => {
  if (!marketCache) await tick()
  if (!marketCache) {
    res.status(503).json({ error: 'No active market', code: 'NO_ACTIVE_MARKET', retryAfter: 5 })
    return
  }
  res.json(marketCache)
})

router.get('/debug', async (_req, res) => {
  const base = Math.floor(Math.floor(Date.now() / 1000) / 900) * 900
  const offsets = [0, 900, -900, 1800, -1800, 2700]
  const results: unknown[] = []
  for (const offset of offsets) {
    const slug = `btc-updown-15m-${base + offset}`
    try {
      const r = await fetch(`${POLYMARKET_BASE}/markets?slug=${slug}`, { headers: HEADERS })
      if (!r.ok) { results.push({ slug, error: r.status }); continue }
      const d = await r.json() as unknown[]
      if (!Array.isArray(d) || d.length === 0) { results.push({ slug, empty: true }); continue }
      const m = d[0] as Record<string, unknown>
      results.push({ slug, active: m.active, closed: m.closed, outcomes: m.outcomes, clobTokenIds: m.clobTokenIds, outcomePrices: m.outcomePrices, endDate: m.endDate })
    } catch (e) { results.push({ slug, error: String(e) }) }
  }
  res.json({ cache: marketCache, activeTokenIds, wsConnected, wsBidPrices, wsAskPrices, raw: results })
})

router.get('/history', (_req, res) => {
  res.json({ snapshots: getOddsHistory() })
})

export default router
