import { Router } from 'express'
import { getSettings } from './settings'

const router = Router()

interface NewsItem {
  id: string
  source: string
  headline: string
  url: string
  publishedAt: string
  impact: 'HIGH' | 'MED' | 'LOW'
  sentiment: 'bullish' | 'bearish' | 'neutral'
}

// ── Sentiment keyword scoring ──────────────────────────────────────────────────
const BULLISH_WORDS = /\b(surge|rally|jump|soar|rise|gain|bull|breakout|record|high|buy|adoption|approval|etf|inflow|milestone|recover|pump|moon|support|upgrade|launch|partnership|integrate|institutional)\b/i
const BEARISH_WORDS = /\b(crash|drop|fall|plunge|dump|bear|sell|ban|hack|scam|fraud|lawsuit|sec|regulation|restrict|fine|penalty|fear|panic|loss|liquidat|warning|risk|concern|decline|dip|correction)\b/i
const HIGH_IMPACT_WORDS = /\b(fed|federal reserve|cpi|inflation|interest rate|sec|etf approved|etf rejected|blackrock|fidelity|coinbase|binance|tether|hack|crash|ban|regulation|congress|senate|treasury|fomc)\b/i

function scoreSentiment(title: string): { sentiment: NewsItem['sentiment']; impact: NewsItem['impact'] } {
  const bull = BULLISH_WORDS.test(title)
  const bear = BEARISH_WORDS.test(title)
  const high = HIGH_IMPACT_WORDS.test(title)

  const sentiment: NewsItem['sentiment'] = bull && !bear ? 'bullish' : bear && !bull ? 'bearish' : 'neutral'
  const impact: NewsItem['impact'] = high ? 'HIGH' : (bull || bear) ? 'MED' : 'LOW'
  return { sentiment, impact }
}

// ── RSS feed parser (no external dep) ─────────────────────────────────────────
function extractRssItems(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(block) ?? /<title[^>]*>([\s\S]*?)<\/title>/.exec(block))?.[1]?.trim()
    const link = (/<link>([\s\S]*?)<\/link>/.exec(block) ?? /<guid[^>]*>(https?[^<]+)<\/guid>/.exec(block))?.[1]?.trim()
    const pubDate = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block))?.[1]?.trim()

    if (!title || !link) continue

    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    const { sentiment, impact } = scoreSentiment(title)

    items.push({
      id: `${sourceName}-${Buffer.from(link).toString('base64').slice(0, 12)}`,
      source: sourceName,
      headline: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
      url: link,
      publishedAt,
      sentiment,
      impact,
    })
  }

  return items
}

// ── RSS feed sources (all free, no API key) ───────────────────────────────────
const RSS_FEEDS = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk' },
  { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph' },
  { url: 'https://decrypt.co/feed', name: 'Decrypt' },
  { url: 'https://bitcoinmagazine.com/.rss/full/', name: 'Bitcoin Magazine' },
]

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/rss+xml, application/xml, text/xml' }

async function fetchRssFeed(url: string, name: string): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    return extractRssItems(xml, name)
  } catch (err) {
    console.error(`[news] RSS fetch error (${name}):`, (err as Error).message)
    return []
  }
}

async function fetchAllFeeds(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(RSS_FEEDS.map((f) => fetchRssFeed(f.url, f.name)))
  const all: NewsItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  // Sort by publish time, dedup by id, take 60 newest
  const seen = new Set<string>()
  return all
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true })
    .slice(0, 60)
}

// ── Cache ──────────────────────────────────────────────────────────────────────
let newsCache: NewsItem[] = []
let newsCacheAt = 0

async function refreshNews() {
  newsCache = await fetchAllFeeds()
  newsCacheAt = Date.now()
  console.log(`[news] fetched ${newsCache.length} items from RSS feeds`)
}

// Initial fetch + every 60s
refreshNews()
setInterval(refreshNews, 60_000)

export function getNewsCache(): NewsItem[] {
  return newsCache.slice(0, 5)
}

// GET /api/news
router.get('/', async (req, res) => {
  const { filter = 'all', limit = '30' } = req.query as Record<string, string>

  // Force refresh if cache is stale
  if (Date.now() - newsCacheAt > 65_000 || newsCache.length === 0) {
    await refreshNews()
  }

  let items = newsCache
  if (filter === 'bullish') items = items.filter((n) => n.sentiment === 'bullish')
  if (filter === 'bearish') items = items.filter((n) => n.sentiment === 'bearish')
  if (filter === 'high_impact') items = items.filter((n) => n.impact === 'HIGH')

  res.json({
    items: items.slice(0, Number(limit)),
    lastUpdated: new Date(newsCacheAt).toISOString(),
  })
})

// GET /api/calendar — economic events via Finnhub
let calendarCache: unknown[] = []
let calendarCacheAt = 0

router.get('/calendar', async (_req, res) => {
  if (Date.now() - calendarCacheAt > 15 * 60_000 || calendarCache.length === 0) {
    const key = getSettings().finnhubApiKey || process.env.FINNHUB_API_KEY
    if (key) {
      try {
        const from = new Date().toISOString().slice(0, 10)
        const to = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
        const r = await fetch(
          `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`,
          { headers: { 'Accept': 'application/json' } }
        )
        if (r.ok) {
          const d = await r.json() as { economicCalendar?: unknown[] }
          calendarCache = (d.economicCalendar ?? [])
            .filter((e: unknown) => (e as Record<string, string>).country === 'US')
          calendarCacheAt = Date.now()
          console.log(`[news] loaded ${calendarCache.length} calendar events`)
        }
      } catch (err) {
        console.error('[news] Finnhub calendar error:', err)
      }
    }
  }

  res.json({ events: calendarCache, lastUpdated: new Date(calendarCacheAt).toISOString() })
})

export default router
