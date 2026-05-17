import { useAppStore } from '../../store'
import styles from './SignalsPanel.module.css'

const LABEL_COLORS: Record<string, string> = {
  'BULL SETUP': '#22c97a',
  'BEAR SETUP': '#e8503a',
  'MIXED': '#d4a830',
  'WEAK': '#233047',
}

const SESSION_COLORS: Record<string, string> = {
  overlap: '#fb923c',
  london:  '#60a5fa',
  ny:      '#c084fc',
  asia:    '#fbbf24',
  off:     '#3a3a55',
}

export function SignalsPanel() {
  const signals = useAppStore((s) => s.signals)
  const windowState = useAppStore((s) => s.windowState)

  if (!signals || !windowState) {
    return <div className={styles.empty}><span className={styles.emptyText}>Waiting for data…</span></div>
  }

  const labelColor = LABEL_COLORS[signals.label] ?? '#3a3a55'
  const candleNums = [1, 2, 3, 4, 5]

  return (
    <div className={styles.panel}>
      {/* C1–C5 pills */}
      <div className={styles.pills}>
        {candleNums.map((n) => {
          const isActive = n === signals.candleNum
          const isPast = n < signals.candleNum
          return (
            <div
              key={n}
              className={`${styles.pill} ${isActive ? styles.pillActive : isPast ? styles.pillPast : styles.pillFuture}`}
            >
              C{n}
            </div>
          )
        })}
      </div>

      {/* Score */}
      <div className={styles.scoreBlock}>
        <div className={styles.scoreNum} style={{ color: labelColor }}>
          {signals.score}
          <span className={styles.scoreOf}>/10</span>
        </div>
        <div className={styles.scoreBadge} style={{ color: labelColor, borderColor: labelColor + '40', background: labelColor + '18' }}>
          {signals.label}
        </div>
      </div>

      {/* Signal rows */}
      <div className={styles.rows}>
        <SignalRow label="Body%" value={`${Math.round(signals.bodyPctPrev)}%`} score={signals.bodyPctPrev} maxScore={100} color="#22c97a" />
        <SignalRow label="% from C1" value={`${signals.pctFromC1 >= 0 ? '+' : ''}${signals.pctFromC1.toFixed(2)}%`} score={Math.abs(signals.pctFromC1)} maxScore={1} color={signals.pctFromC1 >= 0 ? '#22c97a' : '#e8503a'} />
        <div className={styles.row}>
          <div className={styles.dot} style={{ background: SESSION_COLORS[signals.session] ?? '#3a3a55' }} />
          <span className={styles.rowLabel}>Session</span>
          <span className={styles.rowValue} style={{ color: SESSION_COLORS[signals.session] ?? '#3a3a55' }}>
            {signals.session.toUpperCase()}
          </span>
        </div>
        {signals.fibProximity && (
          <>
            <SignalRow label="Fib 0.382" value={signals.fibProximity.fib382} score={signals.fibProximity.fib382 === 'testing' ? 50 : 0} maxScore={100} color="#fbbf24" />
            <SignalRow label="Fib 0.618" value={signals.fibProximity.fib618} score={signals.fibProximity.fib618 === 'testing' ? 50 : 0} maxScore={100} color="#fbbf24" />
          </>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  label: string
  value: string
  score: number
  maxScore: number
  color: string
}

function SignalRow({ label, value, score, maxScore, color }: RowProps) {
  const pct = Math.min(100, (score / maxScore) * 100)
  return (
    <div className={styles.row}>
      <div className={styles.dot} style={{ background: pct > 30 ? color : '#2a2a3a' }} />
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.bar}>
        <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.rowValue}>{value}</span>
    </div>
  )
}
