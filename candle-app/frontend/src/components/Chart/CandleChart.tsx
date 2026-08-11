import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
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

interface ADXPoint { time: UTCTimestamp; adx: number; plusDI: number; minusDI: number }

function computeADX(
  candles: Array<{ time: number; high: number; low: number; close: number }>,
  period = 14,
): ADXPoint[] {
  const n = candles.length
  if (n < period + 2) return []

  const trList: number[] = [], pdmList: number[] = [], mdmList: number[] = []
  for (let i = 1; i < n; i++) {
    const { high: H, low: L } = candles[i]
    const { high: pH, low: pL, close: pC } = candles[i - 1]
    const tr = Math.max(H - L, Math.abs(H - pC), Math.abs(L - pC))
    const up = H - pH, dn = pL - L
    trList.push(tr)
    pdmList.push(up > dn && up > 0 ? up : 0)
    mdmList.push(dn > up && dn > 0 ? dn : 0)
  }
  if (trList.length < period) return []

  let smTR  = trList.slice(0, period).reduce((a, b) => a + b, 0)
  let smPDM = pdmList.slice(0, period).reduce((a, b) => a + b, 0)
  let smMDM = mdmList.slice(0, period).reduce((a, b) => a + b, 0)

  const _step = (sp: number, sm: number, st: number) => {
    const pdi = st ? (100 * sp) / st : 0
    const mdi = st ? (100 * sm) / st : 0
    const den = pdi + mdi
    return { pdi, mdi, dx: den ? (100 * Math.abs(pdi - mdi)) / den : 0 }
  }

  const dxV: number[] = [], pdiV: number[] = [], mdiV: number[] = [], cIdx: number[] = []
  let { pdi, mdi, dx } = _step(smPDM, smMDM, smTR)
  dxV.push(dx); pdiV.push(pdi); mdiV.push(mdi); cIdx.push(period)

  for (let i = period; i < trList.length; i++) {
    smTR  = smTR  - smTR  / period + trList[i]
    smPDM = smPDM - smPDM / period + pdmList[i]
    smMDM = smMDM - smMDM / period + mdmList[i]
    ;({ pdi, mdi, dx } = _step(smPDM, smMDM, smTR))
    dxV.push(dx); pdiV.push(pdi); mdiV.push(mdi); cIdx.push(i + 1)
  }
  if (dxV.length < period) return []

  let adxVal = dxV.slice(0, period).reduce((a, b) => a + b, 0) / period
  const out: ADXPoint[] = []
  out.push({ time: candles[cIdx[period - 1]].time as UTCTimestamp, adx: adxVal, plusDI: pdiV[period - 1], minusDI: mdiV[period - 1] })
  for (let i = period; i < dxV.length; i++) {
    adxVal = (adxVal * (period - 1) + dxV[i]) / period
    out.push({ time: candles[cIdx[i]].time as UTCTimestamp, adx: adxVal, plusDI: pdiV[i], minusDI: mdiV[i] })
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

  const adxContainerRef = useRef<HTMLDivElement>(null)
  const adxChartRef     = useRef<IChartApi | null>(null)
  const adxLineRef      = useRef<ISeriesApi<'Line'> | null>(null)
  const plusDIRef       = useRef<ISeriesApi<'Line'> | null>(null)
  const minusDIRef      = useRef<ISeriesApi<'Line'> | null>(null)

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
      if (adxContainerRef.current && adxChartRef.current) {
        adxChartRef.current.applyOptions({ width: adxContainerRef.current.clientWidth })
      }
    })
    observer.observe(containerRef.current)

    // ── ADX sub-pane ─────────────────────────────────────────────────────────
    if (adxContainerRef.current) {
      const adxChart = createChart(adxContainerRef.current, {
        layout: { background: { type: ColorType.Solid, color: '#080d14' }, textColor: '#647080' },
        grid: { vertLines: { color: '#121a28' }, horzLines: { color: '#121a28' } },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#233047', width: 1, style: 1 }, horzLine: { color: '#233047', width: 1, style: 1 } },
        rightPriceScale: { borderColor: '#233047', textColor: '#647080' },
        timeScale: { visible: false, borderColor: '#233047' },
        handleScroll: true,
        handleScale: true,
        width:  adxContainerRef.current.clientWidth,
        height: adxContainerRef.current.clientHeight,
      })
      adxChartRef.current = adxChart

      adxLineRef.current = adxChart.addLineSeries({ color: '#8f5fcf', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'ADX' })
      plusDIRef.current  = adxChart.addLineSeries({ color: '#22c97a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '+DI' })
      minusDIRef.current = adxChart.addLineSeries({ color: '#e8503a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: '-DI' })

      adxLineRef.current.createPriceLine({ price: 25, color: '#647080', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '25' })

      // Sync scroll/zoom with main chart
      let syncing = false
      chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (syncing || !range) return
        syncing = true
        adxChart.timeScale().setVisibleRange(range)
        syncing = false
      })
      adxChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (syncing || !range) return
        syncing = true
        chart.timeScale().setVisibleRange(range)
        syncing = false
      })
    }

    return () => {
      observer.disconnect()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(series as any).detachPrimitive(primitive)
      primitiveRef.current = null
      maSeriesRef.current  = []
      chart.remove()
      chartRef.current  = null
      seriesRef.current = null
      adxChartRef.current?.remove()
      adxChartRef.current = null
      adxLineRef.current  = null
      plusDIRef.current   = null
      minusDIRef.current  = null
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

    // ADX
    if (adxLineRef.current && plusDIRef.current && minusDIRef.current) {
      const adxPoints = computeADX(sorted)
      adxLineRef.current.setData(adxPoints.map((p) => ({ time: p.time, value: p.adx })))
      plusDIRef.current.setData(adxPoints.map((p) => ({ time: p.time, value: p.plusDI })))
      minusDIRef.current.setData(adxPoints.map((p) => ({ time: p.time, value: p.minusDI })))
    }

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
      <div ref={adxContainerRef} className={styles.adxPane} />
    </div>
  )
}
