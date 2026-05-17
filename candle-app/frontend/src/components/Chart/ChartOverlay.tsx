/**
 * ChartOverlay — LWT v4 Series Primitive
 *
 * Instead of a separate <canvas> overlay (which always lags one frame behind
 * LWT's own canvas during pan/zoom), we attach an ISeriesPrimitive to the
 * candlestick series.  LWT calls our renderer.draw() inside its own render
 * cycle, so our drawings are on the SAME canvas as the candles and painted in
 * the SAME browser frame — zero lag.
 */
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'

// ── Inline type for fancy-canvas (used by LWT v4 primitives) ─────────────────
// We avoid importing from 'fancy-canvas' directly since it's an indirect dep.
type FancyCanvas = {
  useMediaCoordinateSpace(fn: (scope: {
    context: CanvasRenderingContext2D
    mediaSize: { width: number; height: number }
  }) => void): void
}

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  bull:         '#22c97a',
  bullBg:       'rgba(4,26,14,0.94)',
  bear:         '#e8503a',
  bearBg:       'rgba(28,6,4,0.94)',
  live:         '#3a7fd4',
  liveBg:       'rgba(6,14,32,0.94)',
  bodyPct:      '#d4a830',
  bodyPctBg:    'rgba(24,18,2,0.94)',
  clabel:       '#a8b0c0',
  clabelBg:     'rgba(10,16,26,0.88)',
  clabelLive:   '#3a7fd4',
  clabelLiveBg: 'rgba(6,14,32,0.88)',
  c1Line:       'rgba(58,127,212,0.25)',
}

// ── Session bands ─────────────────────────────────────────────────────────────
interface Band { name: string; startHour: number; endHour: number; fill: string; label: string; accent: string }
const BANDS: Band[] = [
  { name: 'ASIA',     startHour: 0,  endHour: 8,  fill: 'rgba(251,191,36,0.035)', label: 'rgba(251,191,36,0.50)', accent: '#fbbf24' },
  { name: 'LONDON',   startHour: 8,  endHour: 16, fill: 'rgba(96,165,250,0.035)', label: 'rgba(96,165,250,0.55)', accent: '#60a5fa' },
  { name: 'OVERLAP',  startHour: 13, endHour: 16, fill: 'rgba(251,146,60,0.06)',  label: 'rgba(251,146,60,0.70)', accent: '#fb923c' },
  { name: 'NEW YORK', startHour: 13, endHour: 21, fill: 'rgba(192,132,252,0.035)',label: 'rgba(192,132,252,0.55)',accent: '#c084fc' },
]

// ── Timeline events ───────────────────────────────────────────────────────────
interface TimelineEvent { label: string; hour: number; minute: number; color: string; style: 'session' | 'event' }
const TIMELINE_EVENTS: TimelineEvent[] = [
  { label: 'Asia Open',      hour: 0,  minute: 0,  color: '#fbbf24', style: 'session' },
  { label: 'London Open',    hour: 8,  minute: 0,  color: '#60a5fa', style: 'session' },
  { label: 'Overlap Start',  hour: 13, minute: 0,  color: '#fb923c', style: 'session' },
  { label: 'London Fix',     hour: 11, minute: 0,  color: '#60a5fa', style: 'event'   },
  { label: 'NY Equity Open', hour: 14, minute: 30, color: '#22c97a', style: 'event'   },
  { label: 'London Close',   hour: 16, minute: 0,  color: '#60a5fa', style: 'session' },
  { label: 'NY Close',       hour: 21, minute: 0,  color: '#c084fc', style: 'session' },
  { label: 'CME Close',      hour: 21, minute: 0,  color: '#e8503a', style: 'event'   },
]

// ── Calendar ──────────────────────────────────────────────────────────────────
interface CalEvent { event: string; time: string; impact: string }
const calCache = { data: [] as CalEvent[], fetchedAt: 0 }
async function loadCalendar() {
  if (Date.now() - calCache.fetchedAt < 5 * 60_000) return
  try {
    const r = await fetch('/api/news/calendar')
    if (r.ok) { const d = await r.json() as { events: CalEvent[] }; calCache.data = d.events ?? []; calCache.fetchedAt = Date.now() }
  } catch {}
}

// ── Constants ─────────────────────────────────────────────────────────────────
const WINDOW_SECONDS  = 900
const CANDLE_SECONDS  = 180
const MIN_PX_FOR_PCT  = 20
const MIN_PX_FOR_CLBL = 12

// ── Drawing helpers ───────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function pill(
  ctx: CanvasRenderingContext2D,
  text: string, cx: number, cy: number,
  fg: string, bg: string,
  fontSize = 10, padX = 5, padY = 3,
) {
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const tw = ctx.measureText(text).width
  const bw = tw + padX * 2
  const bh = fontSize + padY * 2
  roundRect(ctx, cx - bw / 2, cy - fontSize - padY + 1, bw, bh, 3)
  ctx.fillStyle = bg; ctx.fill()
  ctx.fillStyle = fg; ctx.textAlign = 'center'
  ctx.fillText(text, cx, cy)
}

// ── Data types ────────────────────────────────────────────────────────────────
interface CandleSlim { time: number; open: number; high: number; low: number; close: number }
interface MarketData { oddsUp: number; oddsDown: number }

interface WindowGroup { startTime: number; candles: CandleSlim[]; isLive: boolean }
function groupWindows(candles: CandleSlim[], liveTime?: number | null): WindowGroup[] {
  const map = new Map<number, WindowGroup>()
  for (const c of candles) {
    const ws = Math.floor(c.time / WINDOW_SECONDS) * WINDOW_SECONDS
    if (!map.has(ws)) map.set(ws, { startTime: ws, candles: [], isLive: false })
    map.get(ws)!.candles.push(c)
  }
  if (liveTime != null) {
    const ws = Math.floor(liveTime / WINDOW_SECONDS) * WINDOW_SECONDS
    if (map.has(ws)) map.get(ws)!.isLive = true
  }
  return Array.from(map.values()).sort((a, b) => a.startTime - b.startTime)
}

// ── LWT v4 Primitive ──────────────────────────────────────────────────────────
// OverlayPrimitive is instantiated and attached in CandleChart.tsx (inside the
// same useEffect that creates the series) to guarantee correct timing.

/** Called by LWT inside its own render cycle — draws on LWT's canvas directly. */
class OverlayRenderer {
  constructor(private _p: OverlayPrimitive) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  draw(target: FancyCanvas): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const chart  = this._p.chart
      const series = this._p.series
      if (!chart || !series) return

      ctx.save()

      const cw = mediaSize.width
      const ch = mediaSize.height
      // With the primitive API we draw on the pane canvas only — the time axis
      // is a separate LWT element below, so we use the full ch as chart height.
      const chartH = ch

      const range = chart.timeScale().getVisibleRange()
      if (!range) { ctx.restore(); return }
      const fromTs = range.from as number
      const toTs   = range.to   as number

      function tsToX(ts: number): number {
        const coord = chart!.timeScale().timeToCoordinate(ts as UTCTimestamp)
        if (coord != null) return coord
        return (ts - fromTs) / (toTs - fromTs) * cw
      }

      const candlePx    = cw / ((toTs - fromTs) / CANDLE_SECONDS)
      const showPct     = candlePx >= MIN_PX_FOR_PCT
      const showCLabels = candlePx >= MIN_PX_FOR_CLBL

      // ── Session bands ──────────────────────────────────────────────────────
      const fromDay = Math.floor(fromTs / 86400) * 86400 - 86400
      const toDay   = Math.floor(toTs   / 86400) * 86400 + 86400

      for (const band of BANDS) {
        for (let day = fromDay; day <= toDay; day += 86400) {
          const x1 = tsToX(day + band.startHour * 3600)
          const x2 = tsToX(day + band.endHour   * 3600)
          const bx = Math.max(0, Math.min(x1, x2))
          const bw = Math.min(cw, Math.max(x1, x2)) - bx
          if (bw < 2) continue
          ctx.fillStyle = band.fill
          ctx.fillRect(bx, 0, bw, chartH)
          if (bw > 70) {
            ctx.font = '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            ctx.fillStyle = band.label
            ctx.textAlign = 'left'
            ctx.fillText(band.name, bx + 6, 16)
          }
        }
      }

      // ── Sub-event dashed verticals ─────────────────────────────────────────
      const subEvents = [
        { name: 'London Fix', hour: 11, minute: 0,  color: 'rgba(96,165,250,0.35)' },
        { name: 'NY Open',    hour: 14, minute: 30, color: 'rgba(74,222,128,0.35)' },
        { name: 'CME Close',  hour: 21, minute: 0,  color: 'rgba(248,113,113,0.35)' },
      ]
      for (const ev of subEvents) {
        for (let day = fromDay; day <= toDay; day += 86400) {
          const evTs = day + ev.hour * 3600 + ev.minute * 60
          if (evTs < fromTs || evTs > toTs) continue
          const ex = tsToX(evTs)
          ctx.strokeStyle = ev.color; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
          ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, chartH); ctx.stroke()
          ctx.setLineDash([])
        }
      }

      // ── Window overlays ────────────────────────────────────────────────────
      const { candles, currentCandle, market } = this._p
      if (candles.length > 0 || currentCandle) {
        const candleMap = new Map<number, CandleSlim>()
        for (const c of candles) candleMap.set(c.time, c)
        if (currentCandle) candleMap.set(currentCandle.time, currentCandle)
        const allCandles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time)

        const windows = groupWindows(allCandles, currentCandle?.time)

        for (const win of windows) {
          if (win.candles.length === 0) continue
          const first = win.candles[0]
          const last  = win.candles[win.candles.length - 1]
          const isBull = last.close >= first.open
          const prices = win.candles.flatMap((c) => [c.high, c.low])
          const winHigh = Math.max(...prices)
          const winLow  = Math.min(...prices)

          const xStart = tsToX(first.time)
          const xEnd   = tsToX(last.time + CANDLE_SECONDS)
          if (xEnd < -candlePx || xStart > cw + candlePx) continue

          const yTop = series.priceToCoordinate(winHigh)
          const yBot = series.priceToCoordinate(winLow)
          if (yTop == null || yBot == null) continue

          const rx = Math.min(xStart, xEnd)
          const rw = Math.abs(xEnd - xStart)
          const ry = Math.min(yTop, yBot)
          const rh = Math.abs(yBot - yTop)
          if (rw < 1 || rh < 1) continue

          // Box
          ctx.fillStyle   = win.isLive ? 'rgba(58,127,212,0.05)' : isBull ? 'rgba(34,201,122,0.03)' : 'rgba(232,80,58,0.03)'
          ctx.fillRect(rx, ry, rw, rh)
          ctx.strokeStyle = win.isLive ? 'rgba(58,127,212,0.45)' : isBull ? 'rgba(34,201,122,0.22)' : 'rgba(232,80,58,0.22)'
          ctx.lineWidth   = win.isLive ? 1.5 : 1
          ctx.setLineDash(win.isLive ? [4, 3] : [])
          ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
          ctx.setLineDash([])

          // C1 open line
          const c1OpenY = series.priceToCoordinate(first.open)
          if (c1OpenY != null) {
            ctx.strokeStyle = C.c1Line; ctx.lineWidth = 1; ctx.setLineDash([4, 2])
            ctx.beginPath(); ctx.moveTo(rx, c1OpenY); ctx.lineTo(Math.min(rx + rw, cw - 4), c1OpenY); ctx.stroke()
            ctx.setLineDash([])
          }

          // Per-candle labels
          win.candles.forEach((c, idx) => {
            const barX = tsToX(c.time)
            if (barX < -candlePx || barX > cw + candlePx) return
            const midX    = Math.max(8, Math.min(cw - 90, barX + candlePx * 0.5))
            const isActive = win.isLive && idx === win.candles.length - 1

            if (showCLabels) {
              const labelY = Math.min(chartH - 20, yBot + 16)
              pill(ctx, `C${idx + 1}`, midX, labelY,
                isActive ? C.clabelLive : C.clabel,
                isActive ? C.clabelLiveBg : C.clabelBg,
                10)
            }

            if (showPct && idx > 0 && first.open !== 0) {
              // Above-wick: cumulative % from C1 open — shows window progress (C2–C5)
              const pct   = (c.close - first.open) / first.open * 100
              const highY = series.priceToCoordinate(c.high)
              if (highY != null) {
                const label = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
                const ly    = Math.max(18, highY - 14)
                pill(ctx, label, midX, ly,
                  isActive ? C.live : pct >= 0 ? C.bull : C.bear,
                  isActive ? C.liveBg : pct >= 0 ? C.bullBg : C.bearBg,
                  10)
              }
            }

            // ── Candle body % — pill overlaid on the candle body ─────────────
            if (candlePx >= 22 && c.open !== 0) {
              const openY_  = series.priceToCoordinate(c.open)
              const closeY_ = series.priceToCoordinate(c.close)
              if (openY_ != null && closeY_ != null) {
                const bodyTop = Math.min(openY_, closeY_)
                const bodyBot = Math.max(openY_, closeY_)
                const bodyH   = bodyBot - bodyTop
                if (bodyH >= 9) {
                  const bodyPct  = (c.close - c.open) / c.open * 100
                  const bodyLbl  = (bodyPct >= 0 ? '+' : '') + bodyPct.toFixed(2) + '%'
                  const fontSize = bodyH >= 14 ? 8 : 7
                  const fStr     = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
                  ctx.font       = fStr
                  const tw  = ctx.measureText(bodyLbl).width
                  const bpW = tw + 6
                  const bpH = fontSize + 5
                  const bpX = midX - bpW / 2
                  const bpY = bodyTop + (bodyH - bpH) / 2
                  // Semi-transparent dark background so text reads on both green & red
                  roundRect(ctx, bpX, bpY, bpW, bpH, 2)
                  ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill()
                  ctx.font      = fStr
                  ctx.fillStyle = 'rgba(255,255,255,0.90)'
                  ctx.textAlign = 'center'
                  ctx.fillText(bodyLbl, midX, bpY + bpH - 2)
                }
              }
            }
          })

          // Body% label
          if (!win.isLive && win.candles.length === 5 && rw > 44) {
            const centerX = rx + rw / 2
            if (centerX >= 0 && centerX <= cw) {
              const range_   = winHigh - winLow
              const bodyPct  = range_ > 0 ? Math.abs(last.close - first.open) / range_ * 100 : 0
              if (bodyPct >= 10) {
                const lx = Math.min(cw - 84, centerX)
                const ly = Math.max(16, ry - 10)
                pill(ctx, `Body ${Math.round(bodyPct)}%`, lx, ly, C.bodyPct, C.bodyPctBg, 11)
              }
            }
          }

          // Live odds chip
          if (win.isLive && market != null) {
            const centerX = rx + rw / 2
            if (centerX >= 0 && centerX <= cw) {
              const { oddsUp, oddsDown } = market
              const bullOdds = oddsUp > oddsDown
              const pct      = Math.round((bullOdds ? oddsUp : oddsDown) * 100)
              const label    = `${bullOdds ? 'UP' : 'DN'} ${pct}% · live`
              const cx_      = Math.min(cw - 84, centerX)
              const cy_      = Math.max(14, ry - 24)
              pill(ctx, label, cx_, cy_, C.live, C.liveBg, 10)
            }
          }
        }
      }

      // ── Price label + countdown badge ──────────────────────────────────────
      const { currentCandle: cc } = this._p
      const liveCandle = cc ?? (candles.length > 0 ? candles[candles.length - 1] : null)
      if (liveCandle != null) {
        const secsRemaining = cc
          ? (cc.time + CANDLE_SECONDS) - Math.floor(Date.now() / 1000)
          : 0
        const clamped = Math.max(0, Math.min(CANDLE_SECONDS, secsRemaining))
        const mm = Math.floor(clamped / 60).toString().padStart(2, '0')
        const ss = (clamped % 60).toString().padStart(2, '0')
        const closeY = series.priceToCoordinate(liveCandle.close)
        if (closeY != null) {
          const font     = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          ctx.font       = font
          const priceStr = liveCandle.close.toFixed(2)
          const priceW   = ctx.measureText(priceStr).width
          const pW       = Math.max(68, priceW + 16)
          const pH       = 20
          // With the primitive, cw is the pane width (no price axis), so place
          // the badge flush to the right edge of the pane with a small margin.
          const ax = cw - pW - 4
          const pY = Math.min(chartH - pH - 20, Math.max(2, closeY - pH / 2))

          // Dashed horizontal line
          ctx.strokeStyle = 'rgba(129,140,248,0.25)'
          ctx.lineWidth   = 1
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(0, pY + pH / 2)
          ctx.lineTo(ax - 1, pY + pH / 2)
          ctx.stroke()
          ctx.setLineDash([])

          // Price box
          roundRect(ctx, ax, pY, pW, pH, 3)
          ctx.fillStyle  = '#3a7fd4'; ctx.fill()
          ctx.font       = font
          ctx.fillStyle  = '#080d14'; ctx.textAlign = 'center'
          ctx.fillText(priceStr, ax + pW / 2, pY + pH - 5)

          // Timer box
          if (cc) {
            const tW = pW - 8, tH = 16, tX = ax + 4, tY = pY + pH + 2
            roundRect(ctx, tX, tY, tW, tH, 3)
            ctx.fillStyle = 'rgba(30,74,128,0.92)'; ctx.fill()
            ctx.font      = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            ctx.fillStyle = '#a8b0c0'; ctx.textAlign = 'center'
            ctx.fillText(`${mm}:${ss}`, tX + tW / 2, tY + tH - 3)
          }
        }
      }

      // ── Session open/close markers ─────────────────────────────────────────
      const drawnX: number[] = []
      function canDraw(x: number, minGap = 64): boolean {
        if (x < 2 || x > cw - 2) return false
        if (drawnX.some((dx) => Math.abs(dx - x) < minGap)) return false
        drawnX.push(x)
        return true
      }

      for (const ev of TIMELINE_EVENTS) {
        for (let day = fromDay; day <= toDay; day += 86400) {
          const evTs = day + ev.hour * 3600 + ev.minute * 60
          if (evTs < fromTs - 3600 || evTs > toTs + 3600) continue
          const ex = tsToX(evTs)
          if (!canDraw(ex, ev.style === 'session' ? 80 : 60)) continue

          ctx.strokeStyle = ev.color + (ev.style === 'session' ? '55' : '30')
          ctx.lineWidth   = 1
          ctx.setLineDash(ev.style === 'session' ? [4, 5] : [2, 5])
          ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, chartH - 4); ctx.stroke()
          ctx.setLineDash([])

          const label = ev.label.replace(' Open', ' ▶').replace(' Close', ' ◀').replace(' Start', ' ▶')
          ctx.font = `${ev.style === 'session' ? 700 : 600} 8px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
          const tw = ctx.measureText(label).width
          const lw = tw + 8, lh = 13
          const lx = Math.min(cw - lw - 2, Math.max(2, ex - lw / 2))
          const ly = chartH - lh - 4

          roundRect(ctx, lx, ly, lw, lh, 3)
          ctx.fillStyle = 'rgba(8,8,14,0.85)'; ctx.fill()
          ctx.strokeStyle = ev.color + (ev.style === 'session' ? '55' : '33')
          ctx.lineWidth = 1; ctx.stroke()
          ctx.fillStyle = ev.color + (ev.style === 'session' ? 'dd' : '99')
          ctx.textAlign = 'left'
          ctx.fillText(label, lx + 4, ly + lh - 3)
        }
      }

      // ── Economic event markers ─────────────────────────────────────────────
      for (const ev of this._p.calEvents) {
        const impact = (ev.impact ?? '').toUpperCase()
        if (impact === 'LOW') continue
        const evTs = Math.floor(new Date(ev.time).getTime() / 1000)
        if (evTs < fromTs - 3600 || evTs > toTs + 3600) continue
        const ex = tsToX(evTs)
        if (ex < 2 || ex > cw - 2) continue

        const color = impact === 'HIGH' ? '#e8503a' : '#d4a830'
        const ty = chartH - 4
        ctx.fillStyle = color + 'bb'
        ctx.beginPath()
        ctx.moveTo(ex, ty - 7)
        ctx.lineTo(ex - 4, ty)
        ctx.lineTo(ex + 4, ty)
        ctx.closePath()
        ctx.fill()

        if (candlePx > 8) {
          const shortName = ev.event.replace(/\s*(change|index|rate|flash|survey|average|composite)\s*/gi, ' ').trim().slice(0, 16)
          ctx.font = '600 7px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          ctx.fillStyle = color + 'aa'
          ctx.textAlign = 'center'
          ctx.fillText(shortName, ex, ty - 10)
        }
      }

      // ── 1H / 15M Stats panel (top-left) ──────────────────────────────────
      {
        const { candles: rawC, currentCandle: cc } = this._p
        const allC = [...rawC]
        if (cc) allC.push(cc)

        if (allC.length >= 2) {
          // Helpers
          const maxBodyPct = (cs: CandleSlim[]): number =>
            cs.length === 0 ? 0
              : Math.max(...cs.map((c) => c.open !== 0 ? Math.abs((c.close - c.open) / c.open * 100) : 0))

          const winMovePct = (cs: CandleSlim[]): number => {
            if (cs.length < 2) return 0
            const f = cs[0], l = cs[cs.length - 1]
            return f.open !== 0 ? Math.abs((l.close - f.open) / f.open * 100) : 0
          }

          // Last 1 hour = up to 20 × 3-min candles
          const last1h  = allC.slice(-Math.min(allC.length, 20))
          const maxC1h  = maxBodyPct(last1h)
          const wins1h  = groupWindows(last1h, null)
          const maxW1h  = wins1h.length
            ? Math.max(...wins1h.map((w) => winMovePct(w.candles)))
            : 0

          // 1H trend: from first candle's open to last candle's close
          const trendFirst = last1h[0]
          const trendLast  = allC[allC.length - 1]
          const trend1hPct = trendFirst && trendLast && trendFirst.open !== 0
            ? (trendLast.close - trendFirst.open) / trendFirst.open * 100
            : null
          const isBullish1h = (trend1hPct ?? 0) >= 0

          // ── 1H Trend reference line ────────────────────────────────────────
          if (trend1hPct !== null && trendFirst && trendLast) {
            const x0 = tsToX(trendFirst.time)
            const x1 = tsToX(trendLast.time) + candlePx * 0.5 // midpoint of last candle
            const y0 = series.priceToCoordinate(trendFirst.open)
            const y1 = series.priceToCoordinate(trendLast.close)
            if (y0 != null && y1 != null && x1 > x0) {
              const trendCol = isBullish1h ? 'rgba(74,222,128,0.55)' : 'rgba(248,113,113,0.55)'
              ctx.save()
              ctx.strokeStyle = trendCol
              ctx.lineWidth   = 1.2
              ctx.setLineDash([5, 4])
              ctx.beginPath()
              ctx.moveTo(x0, y0)
              ctx.lineTo(x1, y1)
              ctx.stroke()
              ctx.setLineDash([])
              // Dot at start
              ctx.fillStyle = trendCol
              ctx.beginPath(); ctx.arc(x0, y0, 2.5, 0, Math.PI * 2); ctx.fill()
              // Dot at end
              ctx.beginPath(); ctx.arc(x1, y1, 2.5, 0, Math.PI * 2); ctx.fill()
              ctx.restore()
            }
          }

          // ── Current 15-min window move ────────────────────────────────────
          const liveWin    = groupWindows(allC, cc?.time).find((w) => w.isLive)
          const liveFirst  = liveWin?.candles[0]
          const liveLast   = liveWin?.candles[liveWin.candles.length - 1]
          const currWinPct = liveFirst && liveLast && liveFirst.open !== 0
            ? (liveLast.close - liveFirst.open) / liveFirst.open * 100
            : null
          const currWinBull = (currWinPct ?? 0) >= 0

          // ── Stats panel ───────────────────────────────────────────────────
          const font   = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          const trendArrow = trend1hPct != null ? (isBullish1h ? '▲' : '▼') : ''
          const trendStr   = trend1hPct != null
            ? `${trendArrow} ${isBullish1h ? '+' : ''}${trend1hPct.toFixed(2)}%`
            : '—'
          const trendCol2  = trend1hPct != null ? (isBullish1h ? '#22c97a' : '#e8503a') : '#647080'
          const winArrow   = currWinBull ? '▲' : '▼'
          const winStr     = currWinPct != null
            ? `${winArrow} ${currWinBull ? '+' : ''}${currWinPct.toFixed(2)}%`
            : '—'
          const winCol     = currWinPct != null ? (currWinBull ? '#22c97a' : '#e8503a') : '#647080'
          const rows: { tag: string; col: string; text: string; highlight?: { text: string; col: string } }[] = [
            { tag: '1H ', col: '#3a7fd4', text: `max candle ±${maxC1h.toFixed(2)}%   max 15m ±${maxW1h.toFixed(2)}%` },
            { tag: '15M', col: winCol,    text: 'curr window  ', highlight: { text: winStr, col: winCol } },
            { tag: '1H↗', col: trendCol2, text: 'trend  ', highlight: { text: trendStr, col: trendCol2 } },
          ]

          // ── 90-day hour profile row ──────────────────────────────────────────
          const liveTime  = (this._p.currentCandle ?? allC[allC.length - 1])?.time
          const utcHour   = liveTime != null ? new Date(liveTime * 1000).getUTCHours() : null
          const hourStats = utcHour != null ? this._p.voltProfile?.[utcHour] : null
          if (hourStats && hourStats.candleCount > 0) {
            const hTag = `${String(utcHour).padStart(2, '0')}H↺`
            rows.push({
              tag:  hTag,
              col:  '#d4a830',
              text: `90d · cndl ±${hourStats.maxCandle.toFixed(2)}% / ±${hourStats.avgCandle.toFixed(2)}%   15m ±${hourStats.maxWindow.toFixed(2)}%`,
            })
          }

          const lh = 15, bpad = 5, panY = 6
          const panW = 300, panH = rows.length * lh + bpad * 2
          const panX = cw - panW - 8

          roundRect(ctx, panX, panY, panW, panH, 4)
          ctx.fillStyle = 'rgba(8,13,20,0.90)'; ctx.fill()
          ctx.strokeStyle = 'rgba(35,48,71,0.70)'; ctx.lineWidth = 0.5; ctx.stroke()

          rows.forEach((row, i) => {
            const ty = panY + bpad + lh * i + lh - 3
            ctx.font = `700 9px ${font}`; ctx.textAlign = 'left'
            ctx.fillStyle = row.col
            ctx.fillText(row.tag, panX + 7, ty)
            ctx.font = `500 9px ${font}`
            ctx.fillStyle = '#647080'
            ctx.fillText(row.text, panX + 34, ty)
            if (row.highlight) {
              const tw = ctx.measureText(row.text).width
              ctx.font = `700 9px ${font}`
              ctx.fillStyle = row.highlight.col
              ctx.fillText(row.highlight.text, panX + 34 + tw, ty)
            }
          })
        }
      }

      ctx.restore()
    })
  }
}

// ── Primitive ─────────────────────────────────────────────────────────────────
export interface HourStats {
  hour: number; maxCandle: number; avgCandle: number
  maxWindow: number; avgWindow: number; candleCount: number; windowCount: number
}

export class OverlayPrimitive {
  chart:         IChartApi | null = null
  series:        ISeriesApi<'Candlestick'> | null = null
  candles:       CandleSlim[] = []
  currentCandle: CandleSlim | null = null
  market:        MarketData | null = null
  calEvents:     CalEvent[] = []
  voltProfile:   HourStats[] | null = null

  private _requestUpdate: (() => void) | null = null
  private _timerInterval: ReturnType<typeof setInterval> | null = null
  private _calInterval:   ReturnType<typeof setInterval> | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attached(params: { chart: any; series: any; requestUpdate(): void }): void {
    this.chart  = params.chart  as IChartApi
    this.series = params.series as ISeriesApi<'Candlestick'>
    this._requestUpdate = params.requestUpdate
    // Drive the countdown timer — request redraw every second
    this._timerInterval = setInterval(() => this._requestUpdate?.(), 1000)
    // Load + periodically refresh calendar events
    loadCalendar().then(() => { this.calEvents = calCache.data; this.update() })
    this._calInterval = setInterval(() => {
      loadCalendar().then(() => { this.calEvents = calCache.data })
    }, 5 * 60_000)
  }

  detached(): void {
    if (this._timerInterval !== null) clearInterval(this._timerInterval)
    if (this._calInterval   !== null) clearInterval(this._calInterval)
    this.chart  = null
    this.series = null
    this._requestUpdate = null
  }

  update(): void { this._requestUpdate?.() }

  paneViews() {
    if (!this.chart || !this.series) return []
    return [
      {
        zOrder: () => 'top' as const,
        renderer: () => new OverlayRenderer(this),
      },
    ]
  }
}

// OverlayPrimitive is the only export from this module.
// Lifecycle (attach/detach + data sync) is managed in CandleChart.tsx.
