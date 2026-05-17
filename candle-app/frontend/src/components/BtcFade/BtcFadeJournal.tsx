import { useEffect, useState } from 'react'
import styles from './BtcFadeView.module.css'

interface JournalRec {
  signal_id: string; strategy: string; signal_time: string
  entry_candle_open: string; entry_candle_close: string
  direction: 'UP' | 'DOWN'; streak_colour: string; streak_length: number
  hour_utc: number; session: string; day_of_week: string; expected_wr: number
  entry_price: number | null; exit_price: number | null
  result: 'WIN' | 'LOSS' | 'DOJI' | null; directed_pct: number | null
}

interface Stats {
  total: number; wins: number; losses: number; win_rate: number; pnl_100: number
  s4_total: number; s4_wins: number; s4_wr: number
  s5_total: number; s5_wins: number; s5_wr: number
  sessions: Record<string, { total: number; wins: number; wr: number }>
  wr_7d: number | null; wr_30d: number | null
}

const SESSION_ORDER = ['ASIA', 'LONDON', 'OVERLAP', 'NY', 'LATE_NY']
type Filter = 'all' | 'S4-Fade' | 'S5-Fade' | 'WIN' | 'LOSS' | string

function fmt(p: number | null, digits = 2) {
  return p != null ? p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'
}

export function BtcFadeJournal() {
  const [records, setRecords] = useState<JournalRec[]>([])
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [filter,  setFilter]  = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetch('/api/btcfade/journal')
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
    if (filter === 'all')      return true
    if (filter === 'WIN'  || filter === 'LOSS') return r.result === filter
    if (filter === 'S4-Fade' || filter === 'S5-Fade') return r.strategy === filter
    return r.session === filter
  })

  if (loading) return <div className={styles.emptyState}>Loading journal…</div>

  const FILTERS: { label: string; value: Filter }[] = [
    { label: 'All', value: 'all' },
    { label: 'S4-Fade', value: 'S4-Fade' }, { label: 'S5-Fade', value: 'S5-Fade' },
    { label: 'Wins',    value: 'WIN' },      { label: 'Losses',  value: 'LOSS' },
    { label: 'London',  value: 'LONDON' },   { label: 'Late NY', value: 'LATE_NY' },
    { label: 'Asia',    value: 'ASIA' },
  ]

  return (
    <div className={styles.journalWrap}>
      {/* Stats row */}
      {stats && (
        <div className={styles.statRow}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Total Trades</div>
            <div className={styles.statValue}>{stats.total}</div>
            <div className={styles.statSub}>{stats.wins}W · {stats.losses}L</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Win Rate</div>
            <div className={styles.statValue} style={{ color: stats.win_rate >= 57 ? 'var(--up)' : stats.win_rate >= 50 ? 'var(--gold)' : 'var(--dn)' }}>
              {stats.win_rate}%
            </div>
            <div className={styles.statSub}>7d: {stats.wr_7d ?? '—'}% · 30d: {stats.wr_30d ?? '—'}%</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>P&L ($100/trade)</div>
            <div className={styles.statValue} style={{ color: stats.pnl_100 >= 0 ? 'var(--up)' : 'var(--dn)' }}>
              {stats.pnl_100 >= 0 ? '+' : ''}${stats.pnl_100.toLocaleString()}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>S4-Fade WR</div>
            <div className={styles.statValue} style={{ color: '#00d4ff' }}>{stats.s4_wr}%</div>
            <div className={styles.statSub}>{stats.s4_total} trades</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>S5-Fade WR</div>
            <div className={styles.statValue} style={{ color: '#ff6b35' }}>{stats.s5_wr}%</div>
            <div className={styles.statSub}>{stats.s5_total} trades</div>
          </div>
          {/* Session breakdown */}
          {SESSION_ORDER.map((s) => {
            const d = stats.sessions[s]
            if (!d) return null
            return (
              <div key={s} className={styles.statCard}>
                <div className={styles.statLabel}>{s}</div>
                <div className={styles.statValue} style={{ fontSize: 16, color: d.wr >= 57 ? 'var(--up)' : d.wr >= 50 ? 'var(--gold)' : 'var(--dn)' }}>
                  {d.wr}%
                </div>
                <div className={styles.statSub}>{d.total} trades</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filter row */}
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

      {/* Table */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {records.length === 0
            ? 'No trades yet — the live detector will journal signals automatically.'
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
                <th>EWR</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const result  = r.result ?? 'pending'
                const isS5    = r.strategy.includes('S5')
                const dirUp   = r.direction === 'UP'
                const dPctCol = r.directed_pct != null
                  ? r.directed_pct > 0 ? 'var(--up)' : 'var(--dn)'
                  : undefined
                const ewrCol = r.expected_wr >= 0.59 ? 'var(--up)'
                  : r.expected_wr >= 0.57 ? 'var(--gold)' : undefined

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
                      {r.directed_pct != null ? `${r.directed_pct >= 0 ? '+' : ''}${r.directed_pct.toFixed(3)}%` : '—'}
                    </td>
                    <td style={{ color: ewrCol }}>
                      {(r.expected_wr * 100).toFixed(1)}%
                    </td>
                    <td>
                      <span className={`${styles.tag} ${styles['tag' + result.charAt(0) + result.slice(1).toLowerCase()]}`}>
                        {result.toUpperCase()}
                      </span>
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
