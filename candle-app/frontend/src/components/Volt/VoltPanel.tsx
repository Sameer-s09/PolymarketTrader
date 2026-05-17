import { useEffect, useState } from 'react'
import styles from './VoltPanel.module.css'

interface HourStats {
  hour:        number
  maxCandle:   number
  avgCandle:   number
  maxWindow:   number
  avgWindow:   number
  candleCount: number
  windowCount: number
}

interface DbStats {
  count:  number
  oldest: string | null
  newest: string | null
  days:   number
}

// ── Session config ────────────────────────────────────────────────────────────
const SESSIONS = [
  { label: 'ASIA',    start: 0,  end: 8,  color: 'var(--gold)'  },
  { label: 'LONDON',  start: 8,  end: 13, color: 'var(--blue)'  },
  { label: 'OVERLAP', start: 13, end: 16, color: 'oklch(0.72 0.18 50)' },
  { label: 'NY',      start: 16, end: 21, color: 'oklch(0.72 0.13 280)' },
  { label: 'OFF',     start: 21, end: 24, color: 'var(--text2)' },
]

function sessionFor(hour: number) {
  return SESSIONS.find((s) => hour >= s.start && hour < s.end) ?? SESSIONS[SESSIONS.length - 1]
}

// ── Heat colour: 0=green, 1=red ───────────────────────────────────────────────
function heatColor(t: number): string {
  if (t < 0.33) return `oklch(${0.52 + t * 0.15} 0.16 145)`      // green
  if (t < 0.67) return `oklch(0.72 0.16 80)`                       // amber
  return         `oklch(${0.60 - (t - 0.67) * 0.25} 0.20 15)`     // red
}

function normalise(value: number, min: number, max: number): number {
  return max > min ? (value - min) / (max - min) : 0
}

// ── Row config ────────────────────────────────────────────────────────────────
const ROWS: { key: keyof HourStats; label: string; sub: string }[] = [
  { key: 'maxCandle', label: 'MAX CANDLE', sub: 'body %' },
  { key: 'avgCandle', label: 'AVG CANDLE', sub: 'body %' },
  { key: 'maxWindow', label: 'MAX 15M',   sub: 'win %'  },
  { key: 'avgWindow', label: 'AVG 15M',   sub: 'win %'  },
]

export function VoltPanel() {
  const [profile,    setProfile]    = useState<HourStats[]>([])
  const [dbStats,    setDbStats]    = useState<DbStats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [days,       setDays]       = useState(30)
  const [tooltip,    setTooltip]    = useState<{ hour: number; stats: HourStats } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [profRes, dbRes] = await Promise.all([
        fetch('/api/volatility/profile'),
        fetch('/api/volatility/db-stats'),
      ])
      const profJson = await profRes.json() as { profile: HourStats[]; totalCandles: number }
      const dbJson   = await dbRes.json()  as DbStats
      setProfile(profJson.profile ?? [])
      setDbStats(dbJson)
    } catch (e) {
      console.error('[VoltPanel] load error', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const backfill = async () => {
    setBackfilling(true)
    setBackfillMsg(null)
    try {
      const res = await fetch('/api/volatility/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const json = await res.json() as { fetched: number; totalInDb: number; pages: number }
      setBackfillMsg(`Fetched ${json.fetched.toLocaleString()} candles (${json.pages} pages). DB now has ${json.totalInDb.toLocaleString()} candles.`)
      await load()
    } catch (e) {
      setBackfillMsg('Backfill failed.')
      console.error('[VoltPanel] backfill error', e)
    } finally {
      setBackfilling(false)
    }
  }

  // Compute per-row min/max for normalisation
  const rowRanges = ROWS.map(({ key }) => {
    const vals = profile.map((h) => h[key] as number).filter((v) => v > 0)
    return { min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0 }
  })

  // Session-aggregated stats
  const sessionStats = SESSIONS.map((s) => {
    const hours = profile.filter((h) => h.hour >= s.start && h.hour < s.end)
    if (!hours.length) return { ...s, maxCandle: 0, avgCandle: 0, maxWindow: 0, avgWindow: 0, count: 0 }
    return {
      ...s,
      maxCandle: Math.max(...hours.map((h) => h.maxCandle)),
      avgCandle: hours.reduce((acc, h) => acc + h.avgCandle, 0) / hours.length,
      maxWindow: Math.max(...hours.map((h) => h.maxWindow)),
      avgWindow: hours.reduce((acc, h) => acc + h.avgWindow, 0) / hours.length,
      count:     hours.reduce((acc, h) => acc + h.candleCount, 0),
    }
  })

  return (
    <div className={styles.panel}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <span className={styles.title}>VOLATILITY PROFILE</span>
        <span className={styles.subtitle}>
          {dbStats ? `${dbStats.count.toLocaleString()} candles · ${dbStats.days}d history` : '…'}
        </span>
      </div>

      {loading && <div className={styles.loading}>Loading…</div>}

      {!loading && profile.length > 0 && (
        <>
          {/* ── Session summary cards ──────────────────────────────────── */}
          <div className={styles.sessionGrid}>
            {sessionStats.map((s) => {
              const avgCandleNorm = normalise(s.avgCandle,
                Math.min(...sessionStats.map(x => x.avgCandle).filter(Boolean)),
                Math.max(...sessionStats.map(x => x.avgCandle)))
              return (
                <div key={s.label} className={styles.sessionCard} style={{ borderColor: s.color + '66' }}>
                  <span className={styles.sessionLabel} style={{ color: s.color }}>{s.label}</span>
                  <div className={styles.sessionStat}>
                    <span className={styles.sessionStatLabel}>candle</span>
                    <span className={styles.sessionStatVal} style={{ color: heatColor(avgCandleNorm) }}>
                      {s.avgCandle.toFixed(3)}%
                    </span>
                  </div>
                  <div className={styles.sessionStat}>
                    <span className={styles.sessionStatLabel}>15 min</span>
                    <span className={styles.sessionStatVal} style={{ color: heatColor(avgCandleNorm) }}>
                      {s.avgWindow.toFixed(3)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className={styles.divider} />

          {/* ── Heatmap ───────────────────────────────────────────────── */}
          <div className={styles.heatmapWrap}>
            <div className={styles.heatmap}>

              {/* Hour header row */}
              <div className={styles.rowLabel} />
              {Array.from({ length: 24 }, (_, h) => {
                const sess = sessionFor(h)
                return (
                  <div
                    key={h}
                    className={styles.hourHeader}
                    style={{ color: sess.color }}
                    title={`${String(h).padStart(2,'0')}:00 UTC — ${sess.label}`}
                  >
                    {String(h).padStart(2, '0')}
                  </div>
                )
              })}

              {/* Data rows */}
              {ROWS.map(({ key, label, sub }, ri) => (
                <>
                  <div key={`lbl-${key}`} className={styles.rowLabel}>
                    <span className={styles.rowLabelMain}>{label}</span>
                    <span className={styles.rowLabelSub}>{sub}</span>
                  </div>
                  {profile.map((h) => {
                    const val  = h[key] as number
                    const t    = normalise(val, rowRanges[ri].min, rowRanges[ri].max)
                    const bg   = val > 0 ? heatColor(t) : 'var(--bg2)'
                    const isHovered = tooltip?.hour === h.hour
                    return (
                      <div
                        key={`${key}-${h.hour}`}
                        className={`${styles.cell} ${isHovered ? styles.cellHovered : ''}`}
                        style={{
                          background: val > 0 ? bg : 'var(--bg2)',
                          opacity: val > 0 ? (0.35 + t * 0.65) : 0.25,
                          borderColor: isHovered ? 'rgba(255,255,255,0.5)' : 'transparent',
                        }}
                        onMouseEnter={() => setTooltip({ hour: h.hour, stats: h })}
                        onMouseLeave={() => setTooltip(null)}
                        title={`${String(h.hour).padStart(2,'0')}:00 UTC — ${label}: ${val > 0 ? val.toFixed(3) + '%' : 'no data'}`}
                      />
                    )
                  })}
                </>
              ))}

            </div>
          </div>

          {/* ── Tooltip / detail ──────────────────────────────────────── */}
          {tooltip && (
            <div className={styles.tooltip}>
              <span className={styles.tooltipHour} style={{ color: sessionFor(tooltip.hour).color }}>
                {String(tooltip.hour).padStart(2,'0')}:00 UTC — {sessionFor(tooltip.hour).label}
              </span>
              <div className={styles.tooltipGrid}>
                <span className={styles.tooltipLabel}>Max candle</span>
                <span className={styles.tooltipVal}>{tooltip.stats.maxCandle.toFixed(3)}%</span>
                <span className={styles.tooltipLabel}>Avg candle</span>
                <span className={styles.tooltipVal}>{tooltip.stats.avgCandle.toFixed(3)}%</span>
                <span className={styles.tooltipLabel}>Max 15m</span>
                <span className={styles.tooltipVal}>{tooltip.stats.maxWindow.toFixed(3)}%</span>
                <span className={styles.tooltipLabel}>Avg 15m</span>
                <span className={styles.tooltipVal}>{tooltip.stats.avgWindow.toFixed(3)}%</span>
                <span className={styles.tooltipLabel}>Candles</span>
                <span className={styles.tooltipVal}>{tooltip.stats.candleCount}</span>
              </div>
            </div>
          )}

          <div className={styles.divider} />
        </>
      )}

      {/* ── Backfill ──────────────────────────────────────────────────────── */}
      <div className={styles.backfillSection}>
        <span className={styles.sectionLabel}>BACKFILL HISTORY</span>
        <div className={styles.backfillRow}>
          <select
            className={styles.daysSelect}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={backfilling}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            className={styles.backfillBtn}
            onClick={backfill}
            disabled={backfilling}
          >
            {backfilling ? 'Fetching…' : 'Fetch'}
          </button>
          <button
            className={styles.refreshBtn}
            onClick={load}
            disabled={loading || backfilling}
            title="Refresh profile"
          >↻</button>
        </div>
        {backfillMsg && <div className={styles.backfillMsg}>{backfillMsg}</div>}
        <div className={styles.backfillHint}>
          Pulls 3-min OHLC from Bitstamp REST API into the local DB. Run once to get full history, then the profile auto-updates as new candles arrive.
        </div>
      </div>

    </div>
  )
}
