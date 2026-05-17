/**
 * FadeOverlay — LWT v4 Series Primitive for the BTC Fade 15m chart.
 * Draws: session bands (WR-tinted), hot-hour highlights, session WR labels,
 *        session open/close verticals, mock trade entry/exit markers.
 */
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'

// ── fancy-canvas shim ────────────────────────────────────────────────────────
type FancyCanvas = {
  useMediaCoordinateSpace(fn: (scope: {
    context: CanvasRenderingContext2D
    mediaSize: { width: number; height: number }
  }) => void): void
}

// ── Backtest data baked in ───────────────────────────────────────────────────
// Source: 5-year backtest, Bonferroni-corrected, min 30 trades.

interface SessionWR { name: string; utcStart: number; utcEnd: number; s4: number; s5: number; fill: string; accent: string; labelCol: string }
const SESSIONS: SessionWR[] = [
  { name: 'ASIA',    utcStart: 0,  utcEnd: 8,  s4: 57.0, s5: 58.5, fill: 'rgba(251,191,36,0.030)', accent: '#fbbf24', labelCol: 'rgba(251,191,36,0.65)' },
  { name: 'LONDON',  utcStart: 8,  utcEnd: 13, s4: 58.8, s5: 60.1, fill: 'rgba(96,165,250,0.040)', accent: '#60a5fa', labelCol: 'rgba(96,165,250,0.70)' },
  { name: 'OVERLAP', utcStart: 13, utcEnd: 16, s4: 55.1, s5: 55.6, fill: 'rgba(251,146,60,0.025)', accent: '#fb923c', labelCol: 'rgba(251,146,60,0.50)' },
  { name: 'NY',      utcStart: 16, utcEnd: 21, s4: 55.5, s5: 54.9, fill: 'rgba(192,132,252,0.025)', accent: '#c084fc', labelCol: 'rgba(192,132,252,0.50)' },
  { name: 'LATE NY', utcStart: 21, utcEnd: 24, s4: 59.4, s5: 58.3, fill: 'rgba(167,139,250,0.040)', accent: '#a78bfa', labelCol: 'rgba(167,139,250,0.70)' },
]

// Hours where WR is notably elevated (both S4 and S5 hit ≥59%)
// S4≥59% hours: 12(60.9%), 23(60.4%), 21(59.6%), 8(59.1%), 10(59.0%)
// S5≥59% hours: 11(62.9%), 12(61.9%), 1(61.9%), 10(60.6%), 23(60.3%), 21(59.1%)
interface HotHour { hour: number; s4: number; s5: number; tier: 'elite' | 'hot' | 'warm' }
const HOT_HOURS: HotHour[] = [
  { hour: 11, s4: 57.2, s5: 62.9, tier: 'elite' },
  { hour: 12, s4: 60.9, s5: 61.9, tier: 'elite' },
  { hour: 23, s4: 60.4, s5: 60.3, tier: 'hot'   },
  { hour: 21, s4: 59.6, s5: 59.1, tier: 'hot'   },
  { hour:  1, s4: 58.8, s5: 61.9, tier: 'hot'   },
  { hour: 10, s4: 59.0, s5: 60.6, tier: 'hot'   },
  { hour:  8, s4: 59.1, s5: 58.8, tier: 'warm'  },
  { hour:  6, s4: 58.8, s5: 59.2, tier: 'warm'  },
  { hour:  5, s4: 57.1, s5: 59.7, tier: 'warm'  },
]
const HOT_HOUR_MAP = new Map(HOT_HOURS.map((h) => [h.hour, h]))

const TIER_FILL: Record<string, string> = {
  elite: 'rgba(0,212,255,0.045)',
  hot:   'rgba(0,212,255,0.025)',
  warm:  'rgba(0,212,255,0.012)',
}
const TIER_LABEL: Record<string, string> = {
  elite: 'rgba(0,212,255,0.80)',
  hot:   'rgba(0,212,255,0.55)',
  warm:  'rgba(0,212,255,0.35)',
}

// Session verticals (open/close lines)
interface VerticalEvent { label: string; hour: number; min: number; color: string }
const VERTICALS: VerticalEvent[] = [
  { label: 'Asia ▶',    hour:  0, min: 0, color: '#fbbf24' },
  { label: 'London ▶',  hour:  8, min: 0, color: '#60a5fa' },
  { label: 'Overlap ▶', hour: 13, min: 0, color: '#fb923c' },
  { label: 'NY ▶',      hour: 16, min: 0, color: '#c084fc' },
  { label: 'Late NY ▶', hour: 21, min: 0, color: '#a78bfa' },
]

// ── Trade data ────────────────────────────────────────────────────────────────
export interface FadeTrade {
  entryTime: number      // unix seconds — open of prediction candle
  exitTime:  number      // unix seconds — close of prediction candle
  entryPrice: number
  exitPrice:  number | null
  direction:  'UP' | 'DOWN'
  result:     'WIN' | 'LOSS' | 'DOJI' | null
  strategy:   string
  directedPct: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, fg: string, bg: string, fs = 9, px = 4, py = 2) {
  ctx.font = `700 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const tw = ctx.measureText(text).width
  const bw = tw + px * 2, bh = fs + py * 2
  roundRect(ctx, cx - bw / 2, cy - fs - py + 1, bw, bh, 3)
  ctx.fillStyle = bg; ctx.fill()
  ctx.fillStyle = fg; ctx.textAlign = 'center'
  ctx.fillText(text, cx, cy)
}

// ── Renderer ──────────────────────────────────────────────────────────────────
class FadeRenderer {
  constructor(private _p: FadeOverlayPrimitive) {}

  draw(target: FancyCanvas): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const chart  = this._p.chart
      const series = this._p.series
      if (!chart || !series) return

      ctx.save()
      const cw = mediaSize.width
      const ch = mediaSize.height
      const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

      const range = chart.timeScale().getVisibleRange()
      if (!range) { ctx.restore(); return }
      const fromTs = range.from as number
      const toTs   = range.to   as number

      const fromDay = Math.floor(fromTs / 86400) * 86400 - 86400
      const toDay   = Math.floor(toTs   / 86400) * 86400 + 86400

      function tsToX(ts: number): number {
        const coord = chart!.timeScale().timeToCoordinate(ts as UTCTimestamp)
        return coord ?? ((ts - fromTs) / (toTs - fromTs) * cw)
      }

      // Approx px per 15m candle — used to decide label density
      const candlePx = cw / ((toTs - fromTs) / 900)

      // ── 1. Session background bands ─────────────────────────────────────────
      for (const sess of SESSIONS) {
        for (let day = fromDay; day <= toDay; day += 86400) {
          const x1 = tsToX(day + sess.utcStart * 3600)
          const x2 = tsToX(day + sess.utcEnd   * 3600)
          const bx = Math.max(0, Math.min(x1, x2))
          const bw = Math.min(cw, Math.max(x1, x2)) - bx
          if (bw < 2) continue

          ctx.fillStyle = sess.fill
          ctx.fillRect(bx, 0, bw, ch)

          // Session name + WR tag
          if (bw > 72 && candlePx >= 3) {
            ctx.font = `700 9px ${font}`
            ctx.fillStyle = sess.labelCol
            ctx.textAlign = 'left'
            ctx.fillText(sess.name, bx + 5, 14)
            if (bw > 110) {
              const wrS4 = `S4 ${sess.s4.toFixed(1)}%`
              const wrS5 = `S5 ${sess.s5.toFixed(1)}%`
              ctx.font = `500 8px ${font}`
              ctx.fillStyle = sess.labelCol
              ctx.fillText(wrS4, bx + 5, 25)
              ctx.fillText(wrS5, bx + 5, 34)
            }
          }
        }
      }

      // ── 2. Hot-hour highlights ───────────────────────────────────────────────
      if (candlePx >= 2) {
        for (const hh of HOT_HOURS) {
          const fillCol  = TIER_FILL[hh.tier]
          const labelCol = TIER_LABEL[hh.tier]
          for (let day = fromDay; day <= toDay; day += 86400) {
            const x1 = tsToX(day + hh.hour * 3600)
            const x2 = tsToX(day + (hh.hour + 1) * 3600)
            const bx = Math.max(0, Math.min(x1, x2))
            const bw = Math.min(cw, Math.max(x1, x2)) - bx
            if (bw < 1) continue

            ctx.fillStyle = fillCol
            ctx.fillRect(bx, 0, bw, ch)

            // Hour label with top WR
            if (bw > 32 && candlePx >= 5) {
              const best = Math.max(hh.s4, hh.s5)
              const label = hh.tier === 'elite' ? `${String(hh.hour).padStart(2,'0')}h ★ ${best.toFixed(0)}%` : `${String(hh.hour).padStart(2,'0')}h ${best.toFixed(0)}%`
              ctx.font = `${hh.tier === 'elite' ? 700 : 600} 8px ${font}`
              ctx.fillStyle = labelCol
              ctx.textAlign = 'left'
              ctx.fillText(label, bx + 3, ch - 6)
            }
          }
        }
      }

      // ── 3. Session open verticals ────────────────────────────────────────────
      const drawnX: number[] = []
      for (const ev of VERTICALS) {
        for (let day = fromDay; day <= toDay; day += 86400) {
          const evTs = day + ev.hour * 3600 + ev.min * 60
          if (evTs < fromTs - 3600 || evTs > toTs + 3600) continue
          const ex = tsToX(evTs)
          if (ex < 2 || ex > cw - 2) continue
          if (drawnX.some((dx) => Math.abs(dx - ex) < 60)) continue
          drawnX.push(ex)

          ctx.strokeStyle = ev.color + '44'
          ctx.lineWidth = 1
          ctx.setLineDash([4, 5])
          ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, ch - 4); ctx.stroke()
          ctx.setLineDash([])

          if (candlePx >= 2) {
            const lw = ctx.measureText(ev.label).width + 8
            const lh = 12, lx = Math.min(cw - lw - 2, Math.max(2, ex - lw / 2))
            const ly = ch - lh - 20
            roundRect(ctx, lx, ly, lw, lh, 3)
            ctx.fillStyle = 'rgba(8,13,20,0.85)'; ctx.fill()
            ctx.strokeStyle = ev.color + '44'; ctx.lineWidth = 0.7; ctx.stroke()
            ctx.font = `700 8px ${font}`
            ctx.fillStyle = ev.color + 'bb'
            ctx.textAlign = 'left'
            ctx.fillText(ev.label, lx + 4, ly + lh - 3)
          }
        }
      }

      // ── 4. Mock trade markers ────────────────────────────────────────────────
      if (this._p.trades.length > 0) {
        for (const trade of this._p.trades) {
          if (trade.entryTime < fromTs - 7200 || trade.entryTime > toTs + 7200) continue

          const entryX = tsToX(trade.entryTime)
          const exitX  = trade.exitTime ? tsToX(trade.exitTime + 900) : null  // exitTime is candle open; close = +900s

          const entryY = series.priceToCoordinate(trade.entryPrice)
          const exitY  = trade.exitPrice ? series.priceToCoordinate(trade.exitPrice) : null

          if (entryY == null) continue

          const winColor = '#3fb950', lossColor = '#f85149', pendColor = '#e3b341'
          const resultColor = trade.result === 'WIN' ? winColor
            : trade.result === 'LOSS' ? lossColor
            : pendColor

          const isS5 = trade.strategy.includes('S5')
          const stratColor = isS5 ? '#00d4ff' : '#e3b341'

          // Entry vertical line (small)
          ctx.strokeStyle = stratColor + '80'
          ctx.lineWidth = 1.5
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(entryX, entryY - 10)
          ctx.lineTo(entryX, entryY + 10)
          ctx.stroke()

          // Entry arrow
          const arrowDir = trade.direction === 'UP' ? -1 : 1
          ctx.fillStyle = stratColor
          ctx.beginPath()
          ctx.moveTo(entryX, entryY + arrowDir * 14)
          ctx.lineTo(entryX - 5, entryY + arrowDir * 8)
          ctx.lineTo(entryX + 5, entryY + arrowDir * 8)
          ctx.closePath()
          ctx.fill()

          // Connector line to exit
          if (exitX !== null && exitY !== null) {
            ctx.strokeStyle = resultColor + '55'
            ctx.lineWidth = 1
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.moveTo(entryX, entryY)
            ctx.lineTo(exitX, exitY)
            ctx.stroke()
            ctx.setLineDash([])

            // Exit marker
            ctx.fillStyle = resultColor
            ctx.beginPath()
            ctx.arc(exitX, exitY, 4, 0, Math.PI * 2)
            ctx.fill()

            // P&L label
            if (trade.directedPct !== null && candlePx >= 3) {
              const pctStr = `${isS5 ? 'S5' : 'S4'} ${trade.directedPct >= 0 ? '+' : ''}${trade.directedPct.toFixed(2)}%`
              const midX = (entryX + exitX) / 2
              const midY = (entryY + exitY) / 2 - 10
              pill(ctx, pctStr, midX, midY, resultColor, 'rgba(8,13,20,0.88)', 8)
            }
          }
        }
      }

      // ── 5. Current-window edge badge (top-left corner) ───────────────────────
      if (this._p.currentEdge) {
        const { session, hour, s4Wr, s5Wr, isHot } = this._p.currentEdge
        const edgeColor = isHot ? '#00d4ff' : s4Wr >= 57 ? '#3fb950' : '#8b949e'
        const lines = [
          `${isHot ? '★ HOT WINDOW' : 'CURRENT WINDOW'}`,
          `${session}  H${String(hour).padStart(2, '0')} UTC`,
          `S4 ${s4Wr.toFixed(1)}%   S5 ${s5Wr.toFixed(1)}%`,
        ]
        const panX = 8, panY = 8
        const lh = 13, pad = 5
        const panW = 160, panH = lines.length * lh + pad * 2

        roundRect(ctx, panX, panY, panW, panH, 4)
        ctx.fillStyle = 'rgba(8,13,20,0.92)'; ctx.fill()
        ctx.strokeStyle = edgeColor + (isHot ? '55' : '33'); ctx.lineWidth = 1; ctx.stroke()

        lines.forEach((line, i) => {
          ctx.font = `${i === 0 ? 700 : 500} 9px ${font}`
          ctx.fillStyle = i === 0 ? edgeColor : '#8b949e'
          ctx.textAlign = 'left'
          ctx.fillText(line, panX + pad, panY + pad + lh * i + lh - 3)
        })
      }

      ctx.restore()
    })
  }
}

// ── Primitive ─────────────────────────────────────────────────────────────────
export interface CurrentEdge {
  session: string
  hour: number
  s4Wr: number
  s5Wr: number
  isHot: boolean
}

export class FadeOverlayPrimitive {
  chart:        IChartApi | null = null
  series:       ISeriesApi<'Candlestick'> | null = null
  trades:       FadeTrade[] = []
  currentEdge:  CurrentEdge | null = null

  private _requestUpdate: (() => void) | null = null
  private _timer: ReturnType<typeof setInterval> | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attached(params: { chart: any; series: any; requestUpdate(): void }): void {
    this.chart  = params.chart
    this.series = params.series
    this._requestUpdate = params.requestUpdate
    this._timer = setInterval(() => this._requestUpdate?.(), 30_000)
  }

  detached(): void {
    if (this._timer !== null) clearInterval(this._timer)
    this.chart  = null
    this.series = null
    this._requestUpdate = null
  }

  update(): void { this._requestUpdate?.() }

  paneViews() {
    if (!this.chart || !this.series) return []
    return [{ zOrder: () => 'top' as const, renderer: () => new FadeRenderer(this) }]
  }
}

// ── Helper: compute current-window edge from backtest data ─────────────────────
const S4_HOUR_WR: Record<number, number> = { 12:60.9, 23:60.4, 21:59.6, 8:59.1, 10:59.0, 6:58.8, 1:58.8, 0:58.6, 22:58.3, 9:58.1, 11:57.2, 3:57.1 }
const S5_HOUR_WR: Record<number, number> = { 11:62.9, 12:61.9, 1:61.9, 10:60.6, 23:60.3, 5:59.7, 6:59.2, 21:59.1, 8:58.8, 7:58.4, 3:58.2, 0:58.0 }
const S4_SESSION_WR: Record<string, number> = { LATE_NY:59.4, LONDON:58.8, ASIA:57.0, NY:55.5, OVERLAP:55.1 }
const S5_SESSION_WR: Record<string, number> = { LONDON:60.1, ASIA:58.5, LATE_NY:58.3, OVERLAP:55.4, NY:54.8 }

function getSession(hour: number): string {
  if (hour < 8)  return 'ASIA'
  if (hour < 13) return 'LONDON'
  if (hour < 16) return 'OVERLAP'
  if (hour < 21) return 'NY'
  return 'LATE_NY'
}

export function computeCurrentEdge(): CurrentEdge {
  const now  = new Date()
  const hour = now.getUTCHours()
  const sess = getSession(hour)
  const s4h  = S4_HOUR_WR[hour] ?? (S4_SESSION_WR[sess] ?? 55.0)
  const s5h  = S5_HOUR_WR[hour] ?? (S5_SESSION_WR[sess] ?? 55.0)
  const s4   = Math.max(s4h, S4_SESSION_WR[sess] ?? 55.0)
  const s5   = Math.max(s5h, S5_SESSION_WR[sess] ?? 55.0)
  const isHot = (HOT_HOUR_MAP.get(hour)?.tier ?? 'none') === 'elite' ||
    (HOT_HOUR_MAP.get(hour)?.tier ?? 'none') === 'hot'
  return { session: sess, hour, s4Wr: s4, s5Wr: s5, isHot }
}
