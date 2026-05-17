import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import { FadeOverlayPrimitive, computeCurrentEdge, type FadeTrade } from './FadeOverlay'
import styles from './BtcFadeView.module.css'

interface Candle { time: number; open: number; high: number; low: number; close: number }
interface Signal  { time: number; type: 'S4' | 'S5'; direction: 'UP' | 'DOWN'; streakColour: 'green' | 'red' }
interface StreakInfo { length: number; colour: 'green' | 'red' | 'doji' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JournalRecord = Record<string, any>

const S4_COLOR = '#e3b341'   // amber
const S5_COLOR = '#00d4ff'   // cyan

function mapToFadeTrade(r: JournalRecord): FadeTrade {
  return {
    entryTime:   Math.floor(new Date(r.entry_candle_open  as string).getTime() / 1000),
    exitTime:    Math.floor(new Date(r.entry_candle_close as string).getTime() / 1000),
    entryPrice:  r.entry_price as number,
    exitPrice:   (r.exit_price as number | null) ?? null,
    direction:   r.direction as 'UP' | 'DOWN',
    result:      (r.result as 'WIN' | 'LOSS' | 'DOJI' | null) ?? null,
    strategy:    r.strategy as string,
    directedPct: (r.directed_pct as number | null) ?? null,
  }
}

export function BtcFadeChart() {
  const containerRef  = useRef<HTMLDivElement>(null)
  const chartRef      = useRef<IChartApi | null>(null)
  const seriesRef     = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const primitiveRef  = useRef<FadeOverlayPrimitive | null>(null)

  const [streak, setStreak]         = useState<StreakInfo | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<string>('')

  // ── Fetch and render ──────────────────────────────────────────────────────
  const fetchAndRender = useCallback(async () => {
    try {
      // Parallel fetch: candles + journal
      const [candleResp, journalResp] = await Promise.all([
        fetch('/api/btcfade/candles?limit=200'),
        fetch('/api/btcfade/journal'),
      ])
      if (!candleResp.ok) throw new Error(`Candles HTTP ${candleResp.status}`)

      const data = await candleResp.json() as {
        candles: Candle[]
        signals: Signal[]
        streak:  StreakInfo
      }

      setStreak(data.streak)
      setLastUpdate(new Date().toLocaleTimeString())

      if (!seriesRef.current) return

      // Set candle data
      const candleData = data.candles.map((c) => ({
        time:  c.time as UTCTimestamp,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }))
      seriesRef.current.setData(candleData)

      // Build S4/S5 signal markers (arrows on last streak candle)
      const markers = data.signals
        .filter((s) => data.candles.some((c) => c.time === s.time))
        .sort((a, b) => a.time - b.time)
        .map((s) => ({
          time:     s.time as UTCTimestamp,
          position: s.streakColour === 'green' ? 'aboveBar' as const : 'belowBar' as const,
          color:    s.type === 'S5' ? S5_COLOR : S4_COLOR,
          shape:    s.direction === 'DOWN' ? 'arrowDown' as const : 'arrowUp' as const,
          text:     s.type === 'S5'
            ? (s.direction === 'DOWN' ? 'S5 ↓' : 'S5 ↑')
            : (s.direction === 'DOWN' ? 'S4 ↓' : 'S4 ↑'),
          size: s.type === 'S5' ? 2 : 1,
        }))

      seriesRef.current.setMarkers(markers)

      // ── Update the overlay primitive (session bands, trades, edge) ─────────
      const prim = primitiveRef.current
      if (prim) {
        let trades: FadeTrade[] = []
        if (journalResp.ok) {
          const jData = await journalResp.json() as { records: JournalRecord[] }
          trades = jData.records
            .filter((r) => r.entry_price != null)
            .slice(0, 60)          // show last 60 trades on chart
            .map(mapToFadeTrade)
        }
        prim.trades      = trades
        prim.currentEdge = computeCurrentEdge()
        prim.update()
      }

      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Init chart ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background:  { type: ColorType.Solid, color: '#0d1117' },
        textColor:   '#8b949e',
        fontSize:    11,
        fontFamily:  'var(--font-mono, monospace)',
      },
      grid: {
        vertLines: { color: '#1c2128' },
        horzLines: { color: '#1c2128' },
      },
      crosshair: {
        mode:     CrosshairMode.Normal,
        vertLine: { color: '#30363d', labelBackgroundColor: '#161b22' },
        horzLine: { color: '#30363d', labelBackgroundColor: '#161b22' },
      },
      rightPriceScale: {
        borderColor:   '#30363d',
        scaleMargins:  { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor:    '#30363d',
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    8,
        barSpacing:     8,
      },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })

    const series = chart.addCandlestickSeries({
      upColor:         '#3fb950',
      downColor:       '#f85149',
      borderUpColor:   '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor:     '#3fb950',
      wickDownColor:   '#f85149',
    })

    // Attach the FadeOverlay primitive (session bands + hot hours + trades)
    const primitive = new FadeOverlayPrimitive()
    series.attachPrimitive(primitive)

    chartRef.current     = chart
    seriesRef.current    = series
    primitiveRef.current = primitive

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    ro.observe(containerRef.current)

    fetchAndRender()

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current     = null
      seriesRef.current    = null
      primitiveRef.current = null
    }
  }, [fetchAndRender])

  // ── Poll every 60s ────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(fetchAndRender, 60_000)
    return () => clearInterval(id)
  }, [fetchAndRender])

  // ── Streak info overlay ───────────────────────────────────────────────────
  const streakDots = streak && streak.colour !== 'doji' && streak.length > 0
    ? Array.from({ length: Math.min(streak.length, 6) }, (_, i) => (
        <span
          key={i}
          className={`${styles.dot} ${streak.colour === 'green' ? styles.dotGreen : styles.dotRed}`}
        />
      ))
    : null

  const signalBadge = streak && streak.colour !== 'doji'
    ? streak.length >= 5
      ? <span className={styles.badgeS5}>S5 SIGNAL {streak.colour === 'green' ? '↓' : '↑'}</span>
      : streak.length >= 4
        ? <span className={styles.badgeS4}>S4 SIGNAL {streak.colour === 'green' ? '↓' : '↑'}</span>
        : streak.length === 3
          ? <span className={styles.badgeWatch}>3-streak (watch)</span>
          : null
    : null

  return (
    <div className={styles.chartWrap}>
      {/* Info bar */}
      <div className={styles.chartInfoBar}>
        <span className={styles.infoLabel}>BTCUSDT · 15m</span>
        <div className={styles.streakRow}>
          {streakDots}
          {streak && streak.colour !== 'doji' && (
            <span className={styles.streakText}>{streak.length}-streak {streak.colour}</span>
          )}
        </div>
        {signalBadge}
        <div className={styles.legend}>
          <span className={styles.legendS4}>&uarr;&darr; S4</span>
          <span className={styles.legendS5}>&uarr;&darr; S5</span>
        </div>
        <span className={styles.infoUpdated}>{lastUpdate ? `updated ${lastUpdate}` : ''}</span>
      </div>

      {/* Chart */}
      <div ref={containerRef} className={styles.chartContainer} />

      {loading && <div className={styles.chartOverlay}>Loading candles&hellip;</div>}
      {error   && <div className={styles.chartOverlay} style={{ color: '#f85149' }}>{error}</div>}
    </div>
  )
}
