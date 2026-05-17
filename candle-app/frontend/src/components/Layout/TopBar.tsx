import { useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import type { MainTab } from '../../store'
import styles from './TopBar.module.css'

const KEY_SIZE  = 'alert_size_breakout'
const KEY_TREND = 'alert_trend_breakout'
const KEY_BIG   = 'alert_big_candle'
const KEY_WIN   = 'alert_window_breakout'

function useToggle(key: string, defaultOn = false) {
  const [on, setOn] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? defaultOn : stored === 'true'
    } catch { return defaultOn }
  })
  const toggle = () => setOn((prev) => {
    const next = !prev
    try { localStorage.setItem(key, String(next)) } catch {}
    if (next && Notification.permission === 'default') Notification.requestPermission()
    return next
  })
  return [on, toggle] as const
}

export function useAlertsToggle() {
  const [sizeBreakout,    toggleSize]  = useToggle(KEY_SIZE,  true)
  const [trendAligned,    toggleTrend] = useToggle(KEY_TREND, false)
  const [bigCandle,       toggleBig]   = useToggle(KEY_BIG,   true)
  const [windowBreakout,  toggleWin]   = useToggle(KEY_WIN,   true)
  return { sizeBreakout, trendAligned, bigCandle, windowBreakout, toggleSize, toggleTrend, toggleBig, toggleWin }
}

const SESSION_LABELS: Record<string, { label: string; cls: string }> = {
  asia:    { label: 'ASIA',    cls: styles.pillAmber },
  london:  { label: 'LONDON',  cls: styles.pillBlue  },
  overlap: { label: 'OVERLAP', cls: styles.pillOrange },
  ny:      { label: 'NY',      cls: styles.pillPurple },
  off:     { label: 'OFF',     cls: styles.pillMuted  },
}

function useCountdowns() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const s = Math.floor(now / 1000)
  const min3  = 180  - (s % 180)
  const min15 = 900  - (s % 900)
  const hr1   = 3600 - (s % 3600)
  function fmt(sec: number) {
    return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`
  }
  return { min3: fmt(min3), min15: fmt(min15), hr1: fmt(hr1), nowMs: now }
}

function useCityClocks(nowMs: number) {
  function fmt(tz: string) {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: tz,
    }).format(new Date(nowMs))
  }
  return {
    ny:  fmt('America/New_York'),
    ldn: fmt('Europe/London'),
    tky: fmt('Asia/Tokyo'),
  }
}

// Hexagon SVG logo
function HexLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M11 1.5L19.66 6.5V16.5L11 21.5L2.34 16.5V6.5L11 1.5Z"
        stroke="var(--blue)"
        strokeWidth="1.5"
        fill="var(--blue-glow)"
      />
      <path
        d="M11 6L15.33 8.5V13.5L11 16L6.67 13.5V8.5L11 6Z"
        fill="var(--blue)"
        opacity="0.7"
      />
    </svg>
  )
}

interface TopBarProps {
  sizeBreakout:    boolean
  trendAligned:    boolean
  bigCandle:       boolean
  windowBreakout:  boolean
  toggleSize:      () => void
  toggleTrend:     () => void
  toggleBig:       () => void
  toggleWin:       () => void
}

function MainTabSwitcher() {
  const mainTab    = useAppStore((s) => s.mainTab)
  const setMainTab = useAppStore((s) => s.setMainTab)
  return (
    <div className={styles.mainTabGroup}>
      {(['c1c5', 'btcfade'] as MainTab[]).map((t) => (
        <button
          key={t}
          className={`${styles.mainTabBtn} ${mainTab === t ? styles.mainTabActive : ''}`}
          onClick={() => setMainTab(t)}
        >
          {t === 'c1c5' ? 'C1–C5' : 'BTC Fade'}
        </button>
      ))}
    </div>
  )
}

export function TopBar({ sizeBreakout, trendAligned, bigCandle, windowBreakout, toggleSize, toggleTrend, toggleBig, toggleWin }: TopBarProps) {
  const candles       = useAppStore((s) => s.candles)
  const currentCandle = useAppStore((s) => s.currentCandle)
  const signals       = useAppStore((s) => s.signals)
  const wsStatus      = useAppStore((s) => s.wsStatus)
  const countdowns    = useCountdowns()
  const clocks        = useCityClocks(countdowns.nowMs)

  const liveCandle = currentCandle ?? candles[candles.length - 1]
  const price      = liveCandle?.close ?? 0
  const prevClose  = candles.length >= 2 ? candles[candles.length - 2]?.close ?? price : price
  const change     = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0
  const changeDelta = price - prevClose

  const session     = signals?.session ?? 'off'
  const sessionInfo = SESSION_LABELS[session] ?? SESSION_LABELS.off

  // 24H high / low from available candles (best effort)
  const h24 = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : 0
  const l24 = candles.length > 0 ? Math.min(...candles.map(c => c.low))  : 0

  const fmtPrice = (p: number) =>
    p > 0 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '---'

  const priceColor = change >= 0 ? 'var(--up)' : 'var(--dn)'

  return (
    <div className={styles.topbar}>

      {/* Logo */}
      <div className={styles.logoCell}>
        <HexLogo />
      </div>

      {/* Main tab switcher */}
      <MainTabSwitcher />

      {/* Symbol */}
      <div className={styles.symbolCell}>
        <div>
          <div className={styles.symbolName}>BTC/USD</div>
          <div className={styles.symbolSub}>Bitstamp · 3m</div>
        </div>
        <span className={styles.liveBadge}>LIVE</span>
      </div>

      {/* Price */}
      <div className={styles.priceCell}>
        <span className={styles.price} style={{ color: priceColor }}>
          ${fmtPrice(price)}
        </span>
        <div className={styles.priceSub}>
          <span className={styles.change} style={{ color: priceColor }}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
          </span>
          <span className={styles.changeDelta}>
            {changeDelta >= 0 ? '+' : ''}{fmtPrice(Math.abs(changeDelta))}
          </span>
        </div>
      </div>

      {/* 24H High */}
      <div className={styles.statCell}>
        <span className={styles.statLabel}>24H HIGH</span>
        <span className={styles.statVal} style={{ color: 'var(--up)' }}>
          ${fmtPrice(h24)}
        </span>
      </div>

      {/* 24H Low */}
      <div className={styles.statCell}>
        <span className={styles.statLabel}>24H LOW</span>
        <span className={styles.statVal} style={{ color: 'var(--dn)' }}>
          ${fmtPrice(l24)}
        </span>
      </div>

      {/* Session */}
      <div className={styles.cell}>
        <span className={styles.statLabel}>SESSION</span>
        <span className={`${styles.pill} ${sessionInfo.cls}`}>{sessionInfo.label}</span>
      </div>

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Offline indicator */}
      {wsStatus === 'disconnected' && (
        <div className={styles.cell}>
          <span className={styles.offline}>● RECONNECTING</span>
        </div>
      )}

      {/* Alert toggles */}
      <div className={styles.alertGroup}>
        <button
          className={`${styles.alertBtn} ${sizeBreakout ? styles.alertOn : ''}`}
          onClick={toggleSize}
          title="1H Size Breakout — fires C2–C5 when candle body exceeds all candles in the last 1 hour"
        >
          SZ {sizeBreakout ? '🔔' : '🔕'}
        </button>
        <button
          className={`${styles.alertBtn} ${trendAligned ? styles.alertOn : ''}`}
          onClick={toggleTrend}
          title="1H Trend Breakout — size breakout aligned with the 1H trend direction"
        >
          TR {trendAligned ? '🔔' : '🔕'}
        </button>
        <button
          className={`${styles.alertBtn} ${bigCandle ? styles.alertOn : ''}`}
          onClick={toggleBig}
          title="Big Candle — fires on any candle (C1–C5) when body % crosses 0.10%"
        >
          0.1% {bigCandle ? '🔔' : '🔕'}
        </button>
        <button
          className={`${styles.alertBtn} ${windowBreakout ? styles.alertOn : ''}`}
          onClick={toggleWin}
          title="15M Window Breakout — fires when the current 15-min cumulative move reaches the 1H max window"
        >
          15M {windowBreakout ? '🔔' : '🔕'}
        </button>
      </div>

      {/* City clocks */}
      <div className={styles.clocksCell}>
        <div className={styles.clockItem}>
          <span className={styles.clockCity}>NY</span>
          <span className={styles.clockTime}>{clocks.ny}</span>
        </div>
        <div className={styles.clockItem}>
          <span className={styles.clockCity}>LDN</span>
          <span className={styles.clockTime}>{clocks.ldn}</span>
        </div>
        <div className={styles.clockItem}>
          <span className={styles.clockCity}>TKY</span>
          <span className={styles.clockTime}>{clocks.tky}</span>
        </div>
      </div>

      {/* Countdown timers */}
      <div className={styles.countdownsCell}>
        <div className={styles.countdown}>
          <span className={styles.cdLabel}>3 MIN</span>
          <span className={styles.cdValue} style={{ color: 'var(--dn)' }}>{countdowns.min3}</span>
        </div>
        <div className={styles.countdown}>
          <span className={styles.cdLabel}>15 MIN</span>
          <span className={styles.cdValue} style={{ color: 'var(--blue)' }}>{countdowns.min15}</span>
        </div>
        <div className={styles.countdown}>
          <span className={styles.cdLabel}>1 HOUR</span>
          <span className={styles.cdValue} style={{ color: 'var(--up)' }}>{countdowns.hr1}</span>
        </div>
      </div>

    </div>
  )
}
