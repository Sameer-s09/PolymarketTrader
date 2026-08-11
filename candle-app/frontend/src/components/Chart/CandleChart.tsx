import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type DeepPartial,
  type CandlestickSeriesOptions,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useAppStore } from '../../store'
import { OverlayPrimitive } from './ChartOverlay'
import styles from './CandleChart.module.css'

// ── Moving average config ─────────────────────────────────────────────────────
const MA_CONFIGS = [
  { period: 20, label: '1H', color: '#3a7fd4' },   // blue
  { period: 40, label: '2H', color: '#c4920a' },   // gold
  { period: 60, label: '3H', color: '#8f5fcf' },   // purple
  { period: 80, label: '4H', color: '#c45a5a' },   // muted red
] as const

function computeSMA(
  candles: Array<{ time: number; close: number }>,
  period: number,
): Array<{ time: UTCTimestamp; value: number }> {
  const out: Array<{ time: UTCTimestamp; value: number }> = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close
    out.push({ time: candles[i].time as UTCTimestamp, value: sum / period })
  }
  return out
}

function lastSMAPoint(
  candles: Array<{ time: number; close: number }>,
  liveClose: number,
  liveTime: number,
  period: number,
): { time: UTCTimestamp; value: number } | null {
  // Use last (period-1) completed closes + live close
  const slice = candles.slice(-(period - 1)).map((c) => c.close)
  if (slice.length < period - 1) return null
  const sum = slice.reduce((a, b) => a + b, 0) + liveClose
  return { time: liveTime as UTCTimestamp, value: sum / period }
}

export function CandleChart() {
  const containerRef    = useRef<HTMLDivElement>(null)
  const chartRef        = useRef<IChartApi | null>(null)
  const seriesRef       = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const maSeriesRef     = useRef<ISeriesApi<'Line'>[]>([])
  const primitiveRef    = useRef<OverlayPrimitive | null>(null)
  const scrolledRef     = useRef(false)


  const candles       = useAppStore((s) => s.candles)
  const currentCandle = useAppStore((s) => s.currentCandle)
  const market        = useAppStore((s) => s.market)
  const voltProfile   = useAppStore((s) => s.voltProfile)

  // ── Create chart + series + attach primitive in one shot ─────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#080d14' },
        textColor: '#647080',
      },
      grid: {
        vertLines: { color: '#121a28' },
        horzLines: { color: '#121a28' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#233047', width: 1, style: 1 },
        horzLine: { color: '#233047', width: 1, style: 1 },
      },
      rightPriceScale: {
        borderColor: '#233047',
        textColor: '#647080',
      },
      timeScale: {
        borderColor: '#233047',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    })

    const seriesOptions: DeepPartial<CandlestickSeriesOptions> = {
      upColor:        '#22c97a',
      downColor:      '#e8503a',
      borderUpColor:  '#22c97a',
      borderDownColor:'#e8503a',
      wickUpColor:    '#157a4a',
      wickDownColor:  '#8a2c1e',
      lastValueVisible: false,  // drawn by our primitive
      priceLineVisible: false,  // drawn by our primitive
    }

    const series = chart.addCandlestickSeries(seriesOptions)
    chartRef.current  = chart
    seriesRef.current = series

    // ── MA line series ────────────────────────────────────────────────────────
    maSeriesRef.current = MA_CONFIGS.map((cfg) =>
      chart.addLineSeries({
        color:                  cfg.color,
        lineWidth:              1,
        priceLineVisible:       false,
        lastValueVisible:       false,
        crosshairMarkerVisible: false,
        title:                  cfg.label,
      })
    )

    // Attach overlay primitive HERE — series is definitely ready
    const primitive = new OverlayPrimitive()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(series as any).attachPrimitive(primitive)
    primitiveRef.current = primitive

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(series as any).detachPrimitive(primitive)
      primitiveRef.current = null
      maSeriesRef.current  = []
      chart.remove()
      chartRef.current  = null
      seriesRef.current = null
    }
  }, [])

  // ── Load historical candles + compute MAs ────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return
    const seen = new Set<number>()
    const sorted = candles
      .filter((c) => { if (seen.has(c.time)) return false; seen.add(c.time); return true })
      .sort((a, b) => a.time - b.time)
    const data = sorted.map((c) => ({
      time:  c.time as UTCTimestamp,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }))
    seriesRef.current.setData(data)

    // Set MA data
    MA_CONFIGS.forEach((cfg, i) => {
      maSeriesRef.current[i]?.setData(computeSMA(sorted, cfg.period))
    })

    if (!scrolledRef.current) {
      chartRef.current?.timeScale().scrollToRealTime()
      scrolledRef.current = true
    }
  }, [candles])

  // ── Live candle tick + MA live update ────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current || !currentCandle) return
    seriesRef.current.update({
      time:  currentCandle.time as UTCTimestamp,
      open:  currentCandle.open,
      high:  currentCandle.high,
      low:   currentCandle.low,
      close: currentCandle.close,
    })

    // Update live tip of each MA
    MA_CONFIGS.forEach((cfg, i) => {
      const pt = lastSMAPoint(candles, currentCandle.close, currentCandle.time, cfg.period)
      if (pt) maSeriesRef.current[i]?.update(pt)
    })

    if (!scrolledRef.current) {
      chartRef.current?.timeScale().scrollToRealTime()
      scrolledRef.current = true
    }
  }, [currentCandle, candles])

  // ── Sync primitive data ───────────────────────────────────────────────────
  useEffect(() => {
    if (!primitiveRef.current) return
    primitiveRef.current.candles = candles
    primitiveRef.current.update()
  }, [candles])

  useEffect(() => {
    if (!primitiveRef.current) return
    primitiveRef.current.currentCandle = currentCandle
    primitiveRef.current.update()
  }, [currentCandle])

  useEffect(() => {
    if (!primitiveRef.current) return
    primitiveRef.current.market = market
    primitiveRef.current.update()
  }, [market])

  useEffect(() => {
    if (!primitiveRef.current) return
    primitiveRef.current.voltProfile = voltProfile
    primitiveRef.current.update()
  }, [voltProfile])

  // Keep stable refs for any future use
  const getChart  = useCallback(() => chartRef.current,  [])
  const getSeries = useCallback(() => seriesRef.current, [])
  void getChart; void getSeries  // consumed by primitiveRef now

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.chart} />
    </div>
  )
}
