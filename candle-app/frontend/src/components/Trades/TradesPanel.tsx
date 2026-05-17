import { useEffect, useState } from 'react'
import { useAppStore, type Trade } from '../../store'
import styles from './TradesPanel.module.css'

const todayStr = () => new Date().toISOString().slice(0, 10)

function useTrades(date: string) {
  const { trades, tradeStats, setTrades } = useAppStore((s) => ({
    trades: s.trades,
    tradeStats: s.tradeStats,
    setTrades: s.setTrades,
  }))

  const refresh = async () => {
    try {
      const r = await fetch(`/api/trades?date=${date}`)
      if (!r.ok) return
      const d = await r.json() as { trades: Trade[]; stats: typeof tradeStats }
      setTrades(d.trades, d.stats!)
    } catch {}
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  return { trades, tradeStats, refresh }
}

function TradeRow({ trade }: { trade: Trade }) {
  const dir = trade.direction === 'UP'
  const statusClass = trade.outcome === 'WIN' ? styles.win : trade.outcome === 'LOSS' ? styles.loss : styles.open

  return (
    <div className={`${styles.tradeRow} ${statusClass}`}>
      <div className={styles.tradeDir} data-dir={trade.direction}>
        {trade.direction}
      </div>
      <div className={styles.tradeInfo}>
        <span className={styles.tradePrice}>${trade.btc_price.toFixed(0)}</span>
        <span className={styles.tradeMeta}>C{trade.candle_num} · {trade.payout.toFixed(2)}x</span>
      </div>
      <div className={styles.tradeRight}>
        {trade.outcome ? (
          <span className={styles.tradePnl}>
            {trade.pnl! >= 0 ? '+' : ''}{trade.pnl!.toFixed(2)}
          </span>
        ) : (
          <span className={styles.tradeOpen}>OPEN</span>
        )}
        <span className={styles.tradeTime}>
          {new Date(trade.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

export function TradesPanel() {
  const [date, setDate] = useState(todayStr)
  const { trades, tradeStats } = useTrades(date)
  const [activeTab, setActiveTab] = useState<'log' | 'stats'>('log')

  const shiftDate = (days: number) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }
  const isToday = date === todayStr()

  const stats = tradeStats
  const winRate = stats ? stats.win_rate : 0

  return (
    <div className={styles.panel}>
      {/* Stats bar */}
      <div className={styles.statsBar}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>P&L</span>
          <span className={`${styles.statVal} ${(stats?.net_pnl ?? 0) >= 0 ? styles.pos : styles.neg}`}>
            {(stats?.net_pnl ?? 0) >= 0 ? '+' : ''}{(stats?.net_pnl ?? 0).toFixed(2)}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>W/L</span>
          <span className={styles.statVal}>{stats?.wins ?? 0}/{stats?.losses ?? 0}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>WIN%</span>
          <span className={`${styles.statVal} ${winRate >= 55 ? styles.pos : winRate > 0 ? styles.neg : ''}`}>
            {winRate}%
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>OPEN</span>
          <span className={styles.statVal}>{stats?.open ?? 0}</span>
        </div>
      </div>

      {/* Date nav */}
      <div className={styles.dateNav}>
        <button className={styles.dateBtn} onClick={() => shiftDate(-1)}>‹</button>
        <span className={styles.dateLabel}>{isToday ? 'Today' : date}</span>
        <button className={styles.dateBtn} onClick={() => shiftDate(1)} disabled={isToday}>›</button>
      </div>

      {/* Sub tabs */}
      <div className={styles.subTabs}>
        <button className={`${styles.subTab} ${activeTab === 'log' ? styles.active : ''}`} onClick={() => setActiveTab('log')}>LOG</button>
        <button className={`${styles.subTab} ${activeTab === 'stats' ? styles.active : ''}`} onClick={() => setActiveTab('stats')}>STATS</button>
      </div>

      {activeTab === 'log' && (
        <div className={styles.tradeList}>
          {trades.length === 0 ? (
            <div className={styles.empty}>{isToday ? 'No trades today. Use Mock UP / Mock DN to start.' : `No trades on ${date}.`}</div>
          ) : (
            trades.map((t) => <TradeRow key={t.id} trade={t} />)
          )}
        </div>
      )}

      {activeTab === 'stats' && <StatsView />}
    </div>
  )
}

function StatsView() {
  const [analytics, setAnalytics] = useState<{
    byCandleNum: Array<{ candle_num: number; total: number; wins: number; win_rate: number }>
    bySession: Array<{ session: string; total: number; wins: number; win_rate: number; total_pnl: number }>
    byBodyPct: Array<{ bucket: string; total: number; wins: number; win_rate: number }>
    allTime: { total: number; wins: number; win_rate: number; total_pnl: number }
    virtualBalance: number
  } | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/trades/analytics').then(r => r.json()).then(setAnalytics).catch(() => {})
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [])

  if (!analytics) return <div className={styles.empty}>Loading stats…</div>
  if (!analytics.allTime?.total) return <div className={styles.empty}>No resolved trades yet.</div>

  return (
    <div className={styles.statsView}>
      {/* Virtual balance */}
      {analytics.virtualBalance != null && (
        <div className={styles.statsSection}>
          <div className={styles.statsSectionTitle}>VIRTUAL BALANCE</div>
          <div className={styles.allTimeRow}>
            <span className={analytics.virtualBalance >= 100 ? styles.pos : styles.neg}>
              ${analytics.virtualBalance.toFixed(2)}
            </span>
            <span style={{ color: '#5555aa' }}>
              ({analytics.virtualBalance >= 100 ? '+' : ''}{(analytics.virtualBalance - 100).toFixed(2)} from $100)
            </span>
          </div>
        </div>
      )}

      <div className={styles.statsSection}>
        <div className={styles.statsSectionTitle}>BY CANDLE</div>
        {analytics.byCandleNum.map((row) => (
          <div key={row.candle_num} className={styles.statsRow}>
            <span className={styles.statsRowLabel}>C{row.candle_num}</span>
            <div className={styles.statsBar2}>
              <div className={styles.statsBarFill} style={{ width: `${row.win_rate}%` }} />
            </div>
            <span className={styles.statsRowVal}>{row.win_rate}% ({row.total})</span>
          </div>
        ))}
      </div>

      <div className={styles.statsSection}>
        <div className={styles.statsSectionTitle}>BY SESSION</div>
        {analytics.bySession.map((row) => (
          <div key={row.session} className={styles.statsRow}>
            <span className={styles.statsRowLabel}>{row.session?.toUpperCase()}</span>
            <div className={styles.statsBar2}>
              <div className={styles.statsBarFill} style={{ width: `${row.win_rate}%` }} />
            </div>
            <span className={styles.statsRowVal}>{row.win_rate}% ({row.total})</span>
          </div>
        ))}
      </div>

      {analytics.byBodyPct && analytics.byBodyPct.length > 0 && (
        <div className={styles.statsSection}>
          <div className={styles.statsSectionTitle}>BY BODY%</div>
          {analytics.byBodyPct.map((row) => (
            <div key={row.bucket} className={styles.statsRow}>
              <span className={styles.statsRowLabel}>{row.bucket}</span>
              <div className={styles.statsBar2}>
                <div className={styles.statsBarFill} style={{ width: `${row.win_rate}%` }} />
              </div>
              <span className={styles.statsRowVal}>{row.win_rate}% ({row.total})</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.statsSection}>
        <div className={styles.statsSectionTitle}>ALL TIME</div>
        <div className={styles.allTimeRow}>
          <span>Trades: {analytics.allTime.total}</span>
          <span>Win Rate: {analytics.allTime.win_rate}%</span>
          <span className={analytics.allTime.total_pnl >= 0 ? styles.pos : styles.neg}>
            P&L: {analytics.allTime.total_pnl >= 0 ? '+' : ''}{analytics.allTime.total_pnl.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}
