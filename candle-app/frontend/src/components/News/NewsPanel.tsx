import { useEffect, useRef, useState } from 'react'
import { useAppStore, type NewsItem } from '../../store'
import styles from './NewsPanel.module.css'

type NewsFilter = 'all' | 'bullish' | 'bearish' | 'high_impact'

interface CalendarEvent {
  event: string
  time: string
  impact: string
  country: string
  actual: string | number | null
  estimate: string | number | null
  prev: string | number | null
}

function useNews() {
  const { newsItems, setNewsItems } = useAppStore((s) => ({
    newsItems: s.newsItems,
    setNewsItems: s.setNewsItems,
  }))
  const [filter, setFilter] = useState<NewsFilter>('all')
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [tab, setTab] = useState<'news' | 'calendar'>('news')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const refresh = async (f = filter) => {
    try {
      const r = await fetch(`/api/news?filter=${f}&limit=30`)
      if (!r.ok) return
      const d = await r.json() as { items: NewsItem[] }
      setNewsItems(d.items)
    } catch {}
  }

  const refreshCalendar = async () => {
    try {
      const r = await fetch('/api/news/calendar')
      if (!r.ok) return
      const d = await r.json() as { events: CalendarEvent[] }
      setCalendarEvents(d.events ?? [])
    } catch {}
  }

  useEffect(() => {
    refresh()
    refreshCalendar()
    const id = setInterval(() => refresh(filter), 60_000)
    const calId = setInterval(refreshCalendar, 5 * 60_000)
    return () => { clearInterval(id); clearInterval(calId) }
  }, [])

  const applyFilter = (f: NewsFilter) => { setFilter(f); refresh(f) }

  return { newsItems, filter, applyFilter, calendarEvents, tab, setTab, now }
}

const IMPACT_COLORS: Record<string, string> = {
  HIGH: '#e8503a',
  MED:  '#d4a830',
  LOW:  '#3a7fd4',
}
const IMPACT_BG: Record<string, string> = {
  HIGH: 'rgba(232,80,58,0.12)',
  MED:  'rgba(212,168,48,0.12)',
  LOW:  'rgba(58,127,212,0.12)',
}
const SENTIMENT_COLORS: Record<string, string> = {
  bullish: '#22c97a',
  bearish: '#e8503a',
  neutral: '#647080',
}

function NewsCard({ item }: { item: NewsItem }) {
  const impactColor = IMPACT_COLORS[item.impact] ?? '#6666aa'
  const impactBg = IMPACT_BG[item.impact] ?? 'rgba(99,102,241,0.08)'
  const sentColor = SENTIMENT_COLORS[item.sentiment] ?? '#6666aa'
  const timeLabel = new Date(item.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const age = Date.now() - new Date(item.publishedAt).getTime()
  const isOld = age > 4 * 60 * 60 * 1000

  return (
    <div className={`${styles.newsCard} ${isOld ? styles.old : ''}`}>
      <div className={styles.newsHeader}>
        <span className={styles.newsImpact} style={{ color: impactColor, background: impactBg }}>{item.impact}</span>
        <span className={styles.newsSentiment} style={{ color: sentColor }}>{item.sentiment}</span>
        <span className={styles.newsSource}>{item.source}</span>
        <span className={styles.newsTime}>{timeLabel}</span>
      </div>
      <a className={styles.newsHeadline} href={item.url} target="_blank" rel="noreferrer">
        {item.headline}
      </a>
    </div>
  )
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function parseActual(s: string | number | null): number | null {
  if (s == null) return null
  const n = typeof s === 'number' ? s : parseFloat(String(s).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

function CalendarEventCard({ event, now }: { event: CalendarEvent; now: number }) {
  const impact = (event.impact ?? '').toUpperCase()
  const impactColor = IMPACT_COLORS[impact] ?? '#6666aa'
  const impactBg = IMPACT_BG[impact] ?? 'rgba(99,102,241,0.08)'
  const eventTime = new Date(event.time).getTime()
  const isPast = event.actual != null || eventTime < now
  const msUntil = eventTime - now
  const countdown = !isPast ? formatCountdown(msUntil) : null

  // Beat / miss detection: if actual > estimate → beat (good), actual < estimate → miss
  const actualNum = parseActual(event.actual)
  const estNum = parseActual(event.estimate)
  let beatMiss: 'beat' | 'miss' | null = null
  if (actualNum != null && estNum != null) {
    if (actualNum > estNum) beatMiss = 'beat'
    else if (actualNum < estNum) beatMiss = 'miss'
  }

  const timeLabel = new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`${styles.calCard} ${isPast ? styles.calCardPast : styles.calCardUpcoming}`}>
      <div className={styles.calCardHeader}>
        <span className={styles.calImpactBadge} style={{ color: impactColor, background: impactBg }}>
          {impact || 'LOW'}
        </span>
        <span className={styles.calTime}>{timeLabel}</span>
        {countdown && (
          <span className={`${styles.calCountdown} ${msUntil < 15 * 60_000 ? styles.calCountdownHot : ''}`}>
            in {countdown}
          </span>
        )}
        {isPast && beatMiss && (
          <span className={`${styles.calBeatMiss} ${beatMiss === 'beat' ? styles.beat : styles.miss}`}>
            {beatMiss === 'beat' ? '▲ BEAT' : '▼ MISS'}
          </span>
        )}
      </div>

      <div className={styles.calEventName}>{event.event}</div>

      <div className={styles.calDataRow}>
        {event.actual != null && (
          <div className={styles.calDataCell}>
            <span className={styles.calDataLabel}>ACTUAL</span>
            <span className={`${styles.calDataVal} ${beatMiss === 'beat' ? styles.beat : beatMiss === 'miss' ? styles.miss : ''}`}>
              {event.actual}
            </span>
          </div>
        )}
        {event.estimate != null && (
          <div className={styles.calDataCell}>
            <span className={styles.calDataLabel}>ESTIMATE</span>
            <span className={styles.calDataVal}>{event.estimate}</span>
          </div>
        )}
        {event.prev != null && (
          <div className={styles.calDataCell}>
            <span className={styles.calDataLabel}>PREV</span>
            <span className={styles.calDataValMuted}>{event.prev}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function CalendarView({ events, now }: { events: CalendarEvent[]; now: number }) {
  const nowDividerRef = useRef<HTMLDivElement>(null)

  // Sort by time
  const sorted = [...events].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  const past = sorted.filter((e) => e.actual != null || new Date(e.time).getTime() < now)
  const upcoming = sorted.filter((e) => e.actual == null && new Date(e.time).getTime() >= now)

  // Scroll NOW divider into view on mount
  useEffect(() => {
    setTimeout(() => nowDividerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100)
  }, [events.length])

  if (events.length === 0) {
    return <div className={styles.empty}>No calendar events — add a Finnhub API key in Settings</div>
  }

  return (
    <div className={styles.calList}>
      {past.length > 0 && (
        <div className={styles.calSection}>
          <div className={styles.calSectionLabel}>EARLIER TODAY</div>
          {past.map((ev, i) => <CalendarEventCard key={i} event={ev} now={now} />)}
        </div>
      )}

      <div ref={nowDividerRef} className={styles.nowDivider}>
        <span className={styles.nowDividerLabel}>▶ NOW</span>
      </div>

      {upcoming.length > 0 && (
        <div className={styles.calSection}>
          <div className={styles.calSectionLabel}>UPCOMING</div>
          {upcoming.map((ev, i) => <CalendarEventCard key={i} event={ev} now={now} />)}
        </div>
      )}

      {upcoming.length === 0 && (
        <div className={styles.empty}>No more events today</div>
      )}
    </div>
  )
}

const FILTER_LABELS: Record<NewsFilter, string> = {
  all: 'ALL',
  bullish: 'BULL',
  bearish: 'BEAR',
  high_impact: 'HIGH',
}

export function NewsPanel() {
  const { newsItems, filter, applyFilter, calendarEvents, tab, setTab, now } = useNews()

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.tabBtns}>
          <button className={`${styles.tabBtn} ${tab === 'news' ? styles.tabActive : ''}`} onClick={() => setTab('news')}>
            NEWS
          </button>
          <button className={`${styles.tabBtn} ${tab === 'calendar' ? styles.tabActive : ''}`} onClick={() => setTab('calendar')}>
            CALENDAR {calendarEvents.length > 0 && <span className={styles.calCount}>{calendarEvents.length}</span>}
          </button>
        </div>
        {tab === 'news' && (
          <div className={styles.filters}>
            {(Object.keys(FILTER_LABELS) as NewsFilter[]).map((f) => (
              <button
                key={f}
                className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
                onClick={() => applyFilter(f)}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'news' && (
        <div className={styles.list}>
          {newsItems.length === 0
            ? <div className={styles.empty}>Loading news…</div>
            : newsItems.map((item) => <NewsCard key={item.id} item={item} />)
          }
        </div>
      )}

      {tab === 'calendar' && <CalendarView events={calendarEvents} now={now} />}
    </div>
  )
}
