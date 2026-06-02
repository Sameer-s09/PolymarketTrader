import { useEffect, useState } from 'react'
import styles from './BtcFadeView.module.css'

interface MockRec {
  signal_id: string
  strategy: string
  signal_time: string
  direction: 'UP' | 'DOWN'
  streak_colour: string
  streak_length: number
  session: string
  day_of_week: string
  entry_price: number | null
  exit_price: number | null
  poly_odds: number
  poly_payout: number
  poly_market_slug: string
  poly_captured_at: string
  stake: number
  result: 'WIN' | 'LOSS' | 'DOJI' | null
  directed_pct: number | null
  profit: number | null
}

interface StratStats { total: number; wins: number; wr: number; pnl: number }

interface MockStats {
  total: number; wins: number; losses: number; win_rate: number
  actual_pnl: number
  avg_odds_win: number | null; avg_odds_loss: number | null
  s4: StratStats; s5: StratStats
  sessions: Record<string, { total: number; wins: number; wr: number; pnl: number }>
}

const SESSION_ORDER = ['ASIA', 'OVERLAP', 'NY', 'LATE_NY']
type Filter = 'all' | 'S4-Fade' | 'S5-Fade' | 'WIN' | 'LOSS' | string

function fmt(n: number | null, dec = 2) {
  return n != null ? n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'
}

function pnlColor(v: number | null | undefined) {
  if (v == null) return undefined
  return v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : undefined
}

export function BtcFadeMockTrades() {
  const [records, setRecords] = useState<MockRec[]>([])
  const [stats,   setStats]   = useState<MockStats | null>(null)
  const [filter,  setFilter]  = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetch('/api/btcfade/mock-trades')
        const data = await resp.json()
        setRecords(data.records ?? [])
        setStats(data.stats ?? null)
      } catch { /* silent */ } finally { setLoading(false) }
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const filtered = records.filter((r) => {
    if (filter === 'all')    return true
    if (filter === 'WIN' || filter === 'LOSS') return r.result === filter
    if (filter === 'S4-Fade' || filter === 'S5-Fade') return r.strategy === filter
    return r.session === filter
  })

  if (loading) return <div className={styles.emptyState}>Loading mock trades…</div>

  const FILTERS: { label: string; value: Filter }[] = [
    { label: 'All',     value: 'all'     },
    { label: 'S4-Fade', value: 'S4-Fade' },
    { label: 'S5-Fade', value: 'S5-Fade' },
    { label: 'Wins',    value: 'WIN'     },
    { label: 'Losses',  value: 'LOSS'    },
    { label: 'Asia',    value: 'ASIA'    },
    { label: 'Overlap', value: 'OVERLAP' },
    { label: 'NY',      value: 'NY'      },
    { label: 'Late NY', value: 'LATE_NY' },
  ]

  return (
    <div className={styles.journalWrap}>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      {stats && (
        <div className={styles.statRow}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Mock Trades</div>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statSub}>{stats.wins}W · {stats.losses}L</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Win Rate</div>
            <div className={styles.statValue}
              style={{ color: stats.win_rate >= 59 ? 'var(--up)' : stats.win_rate >= 52 ? 'var(--gold)' : 'var(--dn)' }}>
              {stats.win_rate}%
            </div>
            <div className={styles.statSub}>break-even ≈ varies by odds</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Real P&L ($10/trade)</div>
            <div className={styles.statValue} style={{ color: pnlColor(stats.actual_pnl) }}>
              {stats.actual_pnl >= 0 ? '+' : ''}${fmt(stats.actual_pnl)}
            </div>
            <div className={styles.statSub}>actual Polymarket payouts</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Avg Odds (W/L)</div>
            <div className={styles.statValue} style={{ fontSize: 15 }}>
              <span style={{ color: 'var(--up)' }}>{stats.avg_odds_win  != null ? (stats.avg_odds_win  * 100).toFixed(1) + '%' : '—'}</span>
              {' / '}
              <span style={{ color: 'var(--dn)' }}>{stats.avg_odds_loss != null ? (stats.avg_odds_loss * 100).toFixed(1) + '%' : '—'}</span>
            </div>
            <div className={styles.statSub}>Poly implied prob at signal</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>S4 WR / P&L</div>
            <div className={styles.statValue} style={{ color: '#00d4ff', fontSize: 15 }}>
              {stats.s4.wr}%
            </div>
            <div className={styles.statSub} style={{ color: pnlColor(stats.s4.pnl) }}>
              {stats.s4.total} trades · {stats.s4.pnl >= 0 ? '+' : ''}${fmt(stats.s4.pnl)}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>S5 WR / P&L</div>
            <div className={styles.statValue} style={{ color: '#ff6b35', fontSize: 15 }}>
              {stats.s5.wr}%
            </div>
            <div className={styles.statSub} style={{ color: pnlColor(stats.s5.pnl) }}>
              {stats.s5.total} trades · {stats.s5.pnl >= 0 ? '+' : ''}${fmt(stats.s5.pnl)}
            </div>
          </div>
          {/* Session cards */}
          {SESSION_ORDER.map((s) => {
            const d = stats.sessions[s]
            if (!d) return null
            return (
              <div key={s} className={styles.statCard}>
                <div className={styles.statLabel}>{s}</div>
                <div className={styles.statValue} style={{
                  fontSize: 16,
                  color: d.wr >= 59 ? 'var(--up)' : d.wr >= 52 ? 'var(--gold)' : 'var(--dn)',
                }}>
                  {d.wr}%
                </div>
                <div className={styles.statSub} style={{ color: pnlColor(d.pnl) }}>
                  {d.total} trades · {d.pnl >= 0 ? '+' : ''}${fmt(d.pnl)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Filter row ──────────────────────────────────────────────────── */}
      <div className={styles.filterRow}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`${styles.filterBtn} ${filter === f.value ? styles.filterActive : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <span className={styles.filterCount}>{filtered.length} records</span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {records.length === 0
            ? 'No mock trades yet — signals will be auto-recorded (London & Saturday excluded).'
            : 'No records match this filter.'}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Strategy</th>
                <th>Session</th>
                <th>Day</th>
                <th>Direction</th>
                <th>Streak</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Move %</th>
                <th>Poly Odds</th>
                <th>Payout</th>
                <th>Result</th>
                <th>P&L</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const result  = r.result ?? 'pending'
                const isS5    = r.strategy.includes('S5')
                const dirUp   = r.direction === 'UP'
                const dPctCol = r.directed_pct != null
                  ? r.directed_pct > 0 ? 'var(--up)' : 'var(--dn)' : undefined
                // Odds color: closer to 50% = more uncertain = amber; >60% = green
                const oddsColor = r.poly_odds >= 0.58 ? 'var(--up)'
                  : r.poly_odds >= 0.50 ? 'var(--gold)' : 'var(--dn)'

                return (
                  <tr key={r.signal_id} data-result={result}>
                    <td>{r.signal_time.slice(0, 16).replace('T', ' ')}</td>
                    <td>
                      <span className={`${styles.tag} ${isS5 ? styles.tagS5 : styles.tagS4}`}>
                        {r.strategy}
                      </span>
                    </td>
                    <td>{r.session}</td>
                    <td>{(r.day_of_week ?? '').slice(0, 3)}</td>
                    <td>
                      <span className={`${styles.tag} ${dirUp ? styles.tagUp : styles.tagDown}`}>
                        {dirUp ? '▲ UP' : '▼ DOWN'}
                      </span>
                    </td>
                    <td>{r.streak_length}× {r.streak_colour}</td>
                    <td>{r.entry_price != null ? fmt(r.entry_price, 0) : '—'}</td>
                    <td>{r.exit_price  != null ? fmt(r.exit_price,  0) : '—'}</td>
                    <td style={{ color: dPctCol }}>
                      {r.directed_pct != null
                        ? `${r.directed_pct >= 0 ? '+' : ''}${r.directed_pct.toFixed(3)}%`
                        : '—'}
                    </td>
                    <td style={{ color: oddsColor }}>
                      {(r.poly_odds * 100).toFixed(1)}%
                    </td>
                    <td>{r.poly_payout.toFixed(2)}×</td>
                    <td>
                      <span className={`${styles.tag} ${styles['tag' + result.charAt(0) + result.slice(1).toLowerCase()]}`}>
                        {result.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ color: pnlColor(r.profit), fontWeight: 600 }}>
                      {r.profit != null
                        ? `${r.profit >= 0 ? '+' : ''}$${fmt(r.profit)}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
