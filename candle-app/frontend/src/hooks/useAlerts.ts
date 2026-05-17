import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'

// ── In-app flash + optional OS notification ───────────────────────────────────

const WINDOW_SECONDS  = 900   // 15 min
const LOOKBACK        = 20    // candles in 1 hour
const BIG_CANDLE_PCT  = 0.10  // Alert 3 threshold

function bodyPct(open: number, close: number): number {
  return open !== 0 ? Math.abs((close - open) / open * 100) : 0
}

function maxBodyPct(candles: Array<{ open: number; close: number }>): number {
  if (candles.length === 0) return 0
  return Math.max(...candles.map((c) => bodyPct(c.open, c.close)))
}

// Groups candles into 15-min windows, returns max |window move %| across completed windows
function maxWindowPct(candles: Array<{ time: number; open: number; close: number }>, excludeWinStart: number): number {
  const map = new Map<number, Array<{ time: number; open: number; close: number }>>()
  for (const c of candles) {
    const ws = Math.floor(c.time / WINDOW_SECONDS) * WINDOW_SECONDS
    if (ws === excludeWinStart) continue
    if (!map.has(ws)) map.set(ws, [])
    map.get(ws)!.push(c)
  }
  let max = 0
  for (const group of map.values()) {
    if (group.length < 2) continue
    const first = group[0]
    const last  = group[group.length - 1]
    if (first.open === 0) continue
    const pct = Math.abs((last.close - first.open) / first.open * 100)
    if (pct > max) max = pct
  }
  return max
}

function fire(title: string, body: string, tag: string) {
  // Always show in-app flash (works regardless of notification permission)
  useAppStore.getState().addAlertFlash(title, body)

  // Also try OS notification if permission granted
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        icon:    '/favicon.ico',
        badge:   '/favicon.ico',
        tag,
        requireInteraction: false,
      })
      setTimeout(() => n.close(), 8000)
    } catch { /* Safari */ }
  }
}

// ── Alert 1: 1H Size Breakout ────────────────────────────────────────────────
// Fires on C1–C5 when the current candle body % exceeds every candle in
// the last 1 hour — regardless of direction.
// ─────────────────────────────────────────────────────────────────────────────

// ── Alert 2: 1H Trend + Size Breakout ────────────────────────────────────────
// Same size condition as Alert 1, PLUS the candle must move in the same
// direction as the 1-hour trend (open of 1h-ago → current close).
// Filters out counter-trend spikes so you only get trend-aligned breakouts.
// ─────────────────────────────────────────────────────────────────────────────

// ── Alert 3: Big Candle ──────────────────────────────────────────────────────
// Fires on ANY candle (C1–C5) when the body % crosses 0.10% absolute.
// No 1H comparison needed — raw size threshold.
// ─────────────────────────────────────────────────────────────────────────────

// ── Alert 4: 15M Window Breakout ─────────────────────────────────────────────
// Fires once per window when the cumulative window move (|C1 open → current close|)
// reaches or exceeds the max 15-min window move seen in the prior hour.
// Fires regardless of candle number — the window itself is the unit.
// ─────────────────────────────────────────────────────────────────────────────

export function useAlerts(
  sizeBreakoutEnabled: boolean,
  trendAlignedEnabled: boolean,
  bigCandleEnabled:    boolean,
  windowBreakoutEnabled: boolean,
) {
  const candles       = useAppStore((s) => s.candles)
  const currentCandle = useAppStore((s) => s.currentCandle)
  const windowState   = useAppStore((s) => s.windowState)

  // Separate fired-sets so all alerts can independently fire per candle/window
  const firedSizeRef     = useRef(new Set<number>())
  const firedTrendRef    = useRef(new Set<number>())
  const firedBigRef      = useRef(new Set<number>())
  const firedWinRef      = useRef(new Set<number>())  // keyed by windowStartTime

  // Request permission when any alert is turned on
  useEffect(() => {
    if ((sizeBreakoutEnabled || trendAlignedEnabled || bigCandleEnabled || windowBreakoutEnabled) &&
        Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [sizeBreakoutEnabled, trendAlignedEnabled, bigCandleEnabled, windowBreakoutEnabled])

  useEffect(() => {
    if (!sizeBreakoutEnabled && !trendAlignedEnabled && !bigCandleEnabled && !windowBreakoutEnabled) return
    if (!currentCandle) return

    const candleNum  = windowState?.candleNum ?? 0
    const { time, open, close } = currentCandle
    const curBody    = bodyPct(open, close)
    const candleBull = close >= open
    const arrow      = candleBull ? '▲' : '▼'

    // ── Alert 4: 15M Window Breakout ────────────────────────────────────────
    if (windowBreakoutEnabled && windowState) {
      const winStart   = windowState.windowStartTime
      const winPct     = Math.abs(windowState.pctFromC1)
      const last1hAll  = candles.slice(-LOOKBACK)
      const maxWin1h   = maxWindowPct(last1hAll, winStart)
      const winBull    = windowState.pctFromC1 >= 0
      const winArrow   = winBull ? '▲' : '▼'
      if (maxWin1h > 0 && winPct >= maxWin1h && !firedWinRef.current.has(winStart)) {
        firedWinRef.current.add(winStart)
        fire(
          `${winArrow} 15M Window Breakout — C${candleNum} ${winBull ? '+' : '-'}${winPct.toFixed(2)}%`,
          `Window moved ${winPct.toFixed(3)}% — reached 1H max window of ${maxWin1h.toFixed(3)}%`,
          `win-breakout-${winStart}`,
        )
      }
    }

    // ── Alert 3: Big Candle (any candle, absolute threshold) ─────────────────
    if (bigCandleEnabled && curBody >= BIG_CANDLE_PCT && !firedBigRef.current.has(time)) {
      firedBigRef.current.add(time)
      fire(
        `${arrow} Big Candle — C${candleNum} ${candleBull ? '+' : '-'}${curBody.toFixed(2)}%`,
        `Body ${curBody.toFixed(2)}% crossed the ${BIG_CANDLE_PCT.toFixed(2)}% threshold`,
        `big-candle-${time}`,
      )
    }

    // Alerts 1 & 2 fire on C1–C5 (C1 breakouts are valid signals)
    if (candleNum < 1) return

    // Exclude current 15-min window candles from the 1H max —
    // we want to know if this candle breaks out vs PRIOR windows,
    // not vs candles within the same window (C1 shouldn't block C5)
    const curWinStart = Math.floor(time / WINDOW_SECONDS) * WINDOW_SECONDS
    const last1h = candles
      .filter((c) => Math.floor(c.time / WINDOW_SECONDS) * WINDOW_SECONDS !== curWinStart)
      .slice(-LOOKBACK)
    const max1h = maxBodyPct(last1h)

    // ── Shared size condition ─────────────────────────────────────────────
    const sizeBreaks = curBody > max1h

    // ── 1H trend direction ───────────────────────────────────────────────
    const trendFirst  = last1h[0]
    const trendLast   = candles[candles.length - 1]  // last completed candle
    const trend1hBull = trendFirst && trendLast
      ? trendLast.close >= trendFirst.open
      : null

    // ── Alert 1: 1H Size Breakout ─────────────────────────────────────────
    if (sizeBreakoutEnabled && sizeBreaks && !firedSizeRef.current.has(time)) {
      firedSizeRef.current.add(time)
      fire(
        `${arrow} 1H Size Breakout — C${candleNum} ${candleBull ? '+' : '-'}${curBody.toFixed(2)}%`,
        `Body ${curBody.toFixed(2)}% exceeds 1H max of ${max1h.toFixed(2)}%`,
        `size-breakout-${time}`,
      )
    }

    // ── Alert 2: 1H Trend + Size Breakout ────────────────────────────────
    const trendAligned = trend1hBull !== null && candleBull === trend1hBull
    if (trendAlignedEnabled && sizeBreaks && trendAligned && !firedTrendRef.current.has(time)) {
      firedTrendRef.current.add(time)
      const trendStr = candleBull ? 'bullish' : 'bearish'
      fire(
        `${arrow} 1H Trend Breakout — C${candleNum} ${candleBull ? '+' : '-'}${curBody.toFixed(2)}%`,
        `${curBody.toFixed(2)}% move aligned with ${trendStr} 1H trend (max ${max1h.toFixed(2)}%)`,
        `trend-breakout-${time}`,
      )
    }
  }, [currentCandle, sizeBreakoutEnabled, trendAlignedEnabled, bigCandleEnabled, windowBreakoutEnabled, candles, windowState])
}
