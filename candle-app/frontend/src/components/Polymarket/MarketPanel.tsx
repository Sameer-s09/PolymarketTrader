import { useEffect, useState } from 'react'
import { useAppStore, type Trade } from '../../store'
import styles from './MarketPanel.module.css'

interface OddsSnapshot {
  candleNum: number
  oddsUp: number
  oddsDown: number
  btcPrice: number
  capturedAt: string
}

interface EdgeData {
  total: number
  win_rate: number | null
}

interface DailyStats {
  wins: number
  losses: number
  win_rate: number
  net_pnl: number
}

function useTimeRemaining(endTime: string | undefined): { pct: number; label: string } {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!endTime) return { pct: 0, label: '—' }

  const end = new Date(endTime).getTime()
  const total = 15 * 60 * 1000
  const remaining = Math.max(0, end - now)
  const elapsed = total - remaining
  const pct = Math.min(100, (elapsed / total) * 100)
  const secs = Math.floor(remaining / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return { pct, label: `${m}:${s.toString().padStart(2, '0')}` }
}

export function MarketPanel() {
  const { market, addTrade, windowState } = useAppStore((s) => ({
    market: s.market,
    addTrade: s.addTrade,
    windowState: s.windowState,
  }))
  const { pct, label } = useTimeRemaining(market?.endTime)
  const [placing, setPlacing] = useState<'UP' | 'DOWN' | null>(null)
  const [oddsHistory, setOddsHistory] = useState<OddsSnapshot[]>([])
  const [edgeData, setEdgeData] = useState<EdgeData | null>(null)
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null)
  const [allTimeWinRate, setAllTimeWinRate] = useState<{ rate: number; total: number } | null>(null)
  const [stakeInput, setStakeInput] = useState<number>(5)

  // Fetch odds history and edge data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10)
        const [histR, statsR, todayR] = await Promise.all([
          fetch('/api/polymarket/history'),
          fetch('/api/trades/analytics'),
          fetch(`/api/trades?date=${today}`),
        ])
        if (histR.ok) {
          const d = await histR.json() as { snapshots: OddsSnapshot[] }
          setOddsHistory(d.snapshots)
        }
        if (statsR.ok) {
          const d = await statsR.json() as {
            byCandleNum: Array<{ candle_num: number; total: number; win_rate: number }>
            allTime: { total: number; wins: number; win_rate: number }
          }
          // Find edge for current candle_num
          const cn = windowState?.candleNum ?? 0
          const row = d.byCandleNum.find((r) => r.candle_num === cn)
          if (row) setEdgeData({ total: row.total, win_rate: row.win_rate })
          else if (d.allTime?.total > 0) setEdgeData({ total: d.allTime.total, win_rate: d.allTime.win_rate })
          if (d.allTime?.total > 0) setAllTimeWinRate({ rate: d.allTime.win_rate, total: d.allTime.total })
        }
        if (todayR.ok) {
          const d = await todayR.json() as { stats: { wins: number; losses: number; win_rate: number; net_pnl: number } }
          if (d.stats.wins + d.stats.losses > 0) setDailyStats(d.stats)
          else setDailyStats(null)
        }
      } catch {}
    }
    fetchData()
    const id = setInterval(fetchData, 10_000)
    return () => clearInterval(id)
  }, [windowState?.candleNum])

  const placeMockTrade = async (direction: 'UP' | 'DOWN') => {
    if (placing) return
    setPlacing(direction)
    try {
      const r = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, stake: stakeInput }),
      })
      if (r.ok) {
        const trade = await r.json() as Trade
        addTrade(trade)
      }
    } catch {}
    setPlacing(null)
  }

  if (!market) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>Odds unavailable</span>
      </div>
    )
  }

  const upPct = Math.round(market.oddsUp * 100)
  const dnPct = Math.round(market.oddsDown * 100)

  // Edge calculation: compare historical win rate vs implied odds
  const impliedEdgeUp = market.oddsUp > 0 ? (1 / market.payoutUp) : 0
  const winRateDecimal = edgeData?.win_rate != null ? edgeData.win_rate / 100 : null
  const edgePct = winRateDecimal != null ? Math.round((winRateDecimal - impliedEdgeUp) * 100) : null

  return (
    <div className={styles.panel}>
      <div className={styles.oddsRow}>
        <div className={`${styles.oddsCard} ${styles.up}`}>
          <div className={styles.oddsDir}>UP</div>
          <div className={styles.oddsNum}>{upPct}<span className={styles.oddsUnit}>%</span></div>
          <div className={styles.oddsPayout}>{market.payoutUp.toFixed(2)}x</div>
        </div>
        <div className={`${styles.oddsCard} ${styles.dn}`}>
          <div className={styles.oddsDir}>DN</div>
          <div className={styles.oddsNum}>{dnPct}<span className={styles.oddsUnit}>%</span></div>
          <div className={styles.oddsPayout}>{market.payoutDown.toFixed(2)}x</div>
        </div>
      </div>

      <div className={styles.meta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>VOL</span>
          <span className={styles.metaVal}>${(market.volume / 1000).toFixed(1)}k</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>LIQ</span>
          <span className={styles.metaVal}>${(market.liquidity / 1000).toFixed(1)}k</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>TIME</span>
          <span className={styles.metaVal}>{label}</span>
        </div>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>

      {/* Edge analysis */}
      {edgeData && edgePct != null && (
        <div className={styles.edgeCard}>
          <div className={styles.edgeTitle}>EDGE ANALYSIS</div>
          <div className={styles.edgeRow}>
            <span className={styles.edgeLabel}>Your Win Rate (C{windowState?.candleNum})</span>
            <span className={`${styles.edgeVal} ${edgeData.win_rate! >= 55 ? styles.edgePos : edgeData.win_rate! >= 45 ? styles.edgeNeutral : styles.edgeNeg}`}>
              {edgeData.win_rate}%
            </span>
          </div>
          <div className={styles.edgeRow}>
            <span className={styles.edgeLabel}>Implied (UP odds)</span>
            <span className={styles.edgeVal} style={{ color: 'var(--text2)' }}>{Math.round(impliedEdgeUp * 100)}%</span>
          </div>
          <div className={styles.edgeRow}>
            <span className={styles.edgeLabel}>Edge</span>
            <span className={`${styles.edgeVal} ${edgePct > 0 ? styles.edgePos : edgePct < 0 ? styles.edgeNeg : styles.edgeNeutral}`}>
              {edgePct > 0 ? '+' : ''}{edgePct}%
            </span>
          </div>
          <div className={styles.edgeDivider} />
          {/* Today vs All-time win rates */}
          <div className={styles.edgeRow}>
            <span className={styles.edgeLabel}>Today</span>
            <span className={`${styles.edgeVal} ${dailyStats ? (dailyStats.win_rate >= 55 ? styles.edgePos : dailyStats.win_rate >= 45 ? styles.edgeNeutral : styles.edgeNeg) : ''}`}>
              {dailyStats ? `${dailyStats.win_rate}%` : '—'}
              {dailyStats && <span style={{ color: 'var(--text2)', fontSize: 8, marginLeft: 3 }}>({dailyStats.wins}W/{dailyStats.losses}L)</span>}
            </span>
          </div>
          <div className={styles.edgeRow}>
            <span className={styles.edgeLabel}>All-time</span>
            <span className={`${styles.edgeVal} ${allTimeWinRate ? (allTimeWinRate.rate >= 55 ? styles.edgePos : allTimeWinRate.rate >= 45 ? styles.edgeNeutral : styles.edgeNeg) : ''}`}>
              {allTimeWinRate ? `${allTimeWinRate.rate}%` : '—'}
              {allTimeWinRate && <span style={{ color: 'var(--text2)', fontSize: 8, marginLeft: 3 }}>({allTimeWinRate.total})</span>}
            </span>
          </div>
        </div>
      )}

      {/* Odds drift history */}
      {oddsHistory.length > 0 && (
        <div className={styles.driftSection}>
          <div className={styles.driftTitle}>ODDS DRIFT</div>
          {oddsHistory.map((snap) => (
            <div key={snap.candleNum} className={styles.driftRow}>
              <span className={styles.driftLabel}>C{snap.candleNum}</span>
              <div className={styles.driftBar}>
                <div className={styles.driftUp} style={{ width: `${snap.oddsUp * 100}%` }} />
                <div className={styles.driftDown} style={{ width: `${snap.oddsDown * 100}%` }} />
              </div>
              <span className={styles.driftVals}>
                {Math.round(snap.oddsUp * 100)}↑ {Math.round(snap.oddsDown * 100)}↓
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stake input + mock buttons */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: 'var(--text2)' }}>$</span>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={stakeInput}
          onChange={(e) => setStakeInput(parseFloat(e.target.value) || 1)}
          style={{
            width: 44, background: 'var(--bg2)', border: '1px solid var(--border-hi)',
            borderRadius: 3, color: 'var(--blue)', fontSize: 10, padding: '3px 5px',
            outline: 'none', textAlign: 'right',
          }}
        />
      </div>

      <div className={styles.mockBtns}>
        <button
          className={`${styles.mockBtn} ${styles.mockUp}`}
          onClick={() => placeMockTrade('UP')}
          disabled={!!placing}
        >
          {placing === 'UP' ? '…' : `Mock UP ${market.payoutUp.toFixed(2)}x`}
        </button>
        <button
          className={`${styles.mockBtn} ${styles.mockDn}`}
          onClick={() => placeMockTrade('DOWN')}
          disabled={!!placing}
        >
          {placing === 'DOWN' ? '…' : `Mock DN ${market.payoutDown.toFixed(2)}x`}
        </button>
      </div>

      <div className={styles.slug}>{market.slug}</div>
    </div>
  )
}
