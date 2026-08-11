import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
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

const S4_COLOR = '#e3b341'
const S5_COLOR = '#00d4ff'

interface ADXPoint { time: UTCTimestamp; adx: number; plusDI: number; minusDI: number }

function computeADX(candles: Candle[], period = 14): ADXPoint[] {
  const n = candles.length
  if (n < period + 2) return []
  const trL: number[] = [], pdL: number[] = [], mdL: number[] = []
  for (let i = 1; i < n; i++) {
    const { high: H, low: L } = candles[i]
    const { high: pH, low: pL, close: pC } = candles[i - 1]
    const tr = Math.max(H - L, Math.abs(H - pC), Math.abs(L - pC))
    const up = H - pH, dn = pL - L
    trL.push(tr)
    pdL.push(up > dn && up > 0 ? up : 0)
    mdL.push(dn > up && dn > 0 ? dn : 0)
  }
  if (trL.length < period) return []
  let smTR = trL.slice(0, period).reduce((a, b) => a + b, 0)
  let smPD = pdL.slice(0, period).reduce((a, b) => a + b, 0)
  let smMD = mdL.slice(0, period).reduce((a, b) => a + b, 0)
  const _s = (sp: number, sm: number, st: number) => {
    const pdi = st ? (100 * sp) / st : 0, mdi = st ? (100 * sm) / st : 0
    const den = pdi + mdi
    return { pdi, mdi, dx: den ? (100 * Math.abs(pdi - mdi)) / den : 0 }
  }
  const dxV: number[] = [], pdiV: number[] = [], mdiV: number[] = [], cI: number[] = []
  let { pdi, mdi, dx } = _s(smPD, smMD, smTR)
  dxV.push(dx); pdiV.push(pdi); mdiV.push(mdi); cI.push(period)
  for (let i = period; i < trL.length; i++) {
    smTR = smTR - smTR / period + trL[i]
    smPD = smPD - smPD / period + pdL[i]
    smMD = smMD - smMD / period + mdL[i]
    ;({ pdi, mdi, dx } = _s(smPD, smMD, smTR))
    dxV.push(dx); pdiV.push(pdi); mdiV.push(mdi); cI.push(i + 1)
  }
  if (dxV.length < period) return []
  let adxVal = dxV.slice(0, period).reduce((a, b) => a + b, 0) / period
  const out: ADXPoint[] = []
  out.push({ time: candles[cI[period - 1]].time as UTCTimestamp, adx: adxVal, plusDI: pdiV[period - 1], minusDI: mdiV[period - 1] })
  for (let i = period; i < dxV.length; i++) {
    adxVal = (adxVal * (period - 1) + dxV[i]) / period
    out.push({ time: candles[cI[i]].time as UTCTimestamp, adx: adxVal, plusDI: pdiV[i], minusDI: mdiV[i] })
  }
  return out
}

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

  const adxContainerRef = useRef<HTMLDivElement>(null)
  const adxChartRef     = useRef<IChartApi | null>(null)
  const adxLineRef      = useRef<ISeriesApi<'Line'> | null>(null)
  const plusDIRef       = useRef<ISeriesApi<'Line'> | null>(null)
  const minusDIRef      = useRef<ISeriesApi<'Line'> | null>(null)

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

      // ADX pane
      if (adxLineRef.current && plusDIRef.current && minusDIRef.current) {
        const pts = computeADX(data.candles)
        adxLineRef.current.setData(pts.map((p) => ({ time: p.time, value: p.adx })))
        plusDIRef.current.setData(pts.map((p) => ({ time: p.time, value: p.plusDI })))
        minusDIRef.current.setData(pts.map((p) => ({ time: p.time, value: p.minusDI })))
      }

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
      if (adxContainerRef.current && adxChartRef.current) {
        adxChartRef.current.applyOptions({ width: adxContainerRef.current.clientWidth })
      }
    })
    ro.observe(containerRef.current)

    // ── ADX sub-pane ─────────────────────────────────────────────────────────
    if (adxContainerRef.current) {
      const adxChart = createChart(adxContainerRef.current, {
        layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e', fontSize: 11 },
        grid: { vertLines: { color: '#1c2128' }, horzLines: { color: '#1c2128' } },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#30363d', labelBackgroundColor: '#161b22' }, horzLine: { color: '#30363d', labelBackgroundColor: '#161b22' } },
        rightPriceScale: { borderColor: '#30363d' },
        timeScale: { visible: false, borderColor: '#30363d' },
        handleScroll: true,
        handleScale: true,
        width:  adxContainerRef.current.clientWidth,
        height: adxContainerRef.current.clientHeight,
      })
      adxChartRef.current = adxChart

      adxLineRef.current = adxChart.addLineSeries({ color: '#bc8cff', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ADX' })
      plusDIRef.current  = adxChart.addLineSeries({ color: '#3fb950', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '+DI' })
      minusDIRef.current = adxChart.addLineSeries({ color: '#f85149', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '-DI' })
      adxLineRef.current.createPriceLine({ price: 25, color: '#8b949e', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '25' })

      let syncing = false
      chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        if (syncing) return
        const range = chart.timeScale().getVisibleRange()
        if (!range) return
        syncing = true
        try { adxChart.timeScale().setVisibleRange(range) } catch { /* ignore */ }
        syncing = false
      })
      adxChart.timeScale().subscribeVisibleTimeRangeChange(() => {
        if (syncing) return
        const range = adxChart.timeScale().getVisibleRange()
        if (!range) return
        syncing = true
        try { chart.timeScale().setVisibleRange(range) } catch { /* ignore */ }
        syncing = false
      })
    }

    fetchAndRender()

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current     = null
      seriesRef.current    = null
      primitiveRef.current = null
      adxChartRef.current?.remove()
      adxChartRef.current = null
      adxLineRef.current  = null
      plusDIRef.current   = null
      minusDIRef.current  = null
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
      <div ref={adxContainerRef} className={styles.adxPane} />

      {loading && <div className={styles.chartOverlay}>Loading candles&hellip;</div>}
      {error   && <div className={styles.chartOverlay} style={{ color: '#f85149' }}>{error}</div>}
    </div>
  )
}
