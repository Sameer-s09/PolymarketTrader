import { useAppStore } from '../../store'
import styles from './AlertsPanel.module.css'

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour:     '2-digit',
    minute:   '2-digit',
    second:   '2-digit',
    hour12:   false,
    timeZone: 'UTC',
  }).format(new Date(ts))
}

function alertColor(title: string): string {
  if (title.includes('▲')) return 'var(--up)'
  if (title.includes('▼')) return 'var(--dn)'
  return 'var(--blue)'
}

export function AlertsPanel() {
  const history      = useAppStore((s) => s.alertHistory)
  const clearHistory = useAppStore((s) => s.clearAlertHistory)

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>ALERT HISTORY</span>
        <span className={styles.count}>{history.length} alerts</span>
        {history.length > 0 && (
          <button className={styles.clearBtn} onClick={clearHistory} title="Clear all">
            ✕ clear
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className={styles.empty}>No alerts yet this session</div>
      ) : (
        <div className={styles.list}>
          {history.map((a) => {
            const color = alertColor(a.title)
            return (
              <div key={a.id} className={styles.row} style={{ borderLeftColor: color }}>
                <div className={styles.rowTop}>
                  <span className={styles.rowTitle} style={{ color }}>{a.title}</span>
                  <span className={styles.rowTime}>{fmtTime(a.ts)}</span>
                </div>
                <span className={styles.rowBody}>{a.body}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
