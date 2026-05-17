import { useAppStore } from '../../store'
import styles from './NavBar.module.css'

export function NavBar() {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setTab = useAppStore((s) => s.setRightPanelTab)

  return (
    <nav className={styles.nav}>
      <button className={`${styles.btn} ${styles.active}`} title="Chart (1)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1,10 4,6 7,8 10,4 13,2" />
          <line x1="1" y1="13" x2="13" y2="13" />
        </svg>
      </button>
      <button className={styles.btn} title="Trades (3)" onClick={() => setTab('trades')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="8" width="3" height="5" rx="0.5" />
          <rect x="5.5" y="5" width="3" height="8" rx="0.5" />
          <rect x="10" y="2" width="3" height="11" rx="0.5" />
        </svg>
      </button>
      <div className={styles.divider} />
      <button className={styles.btn} title="Journal (J)" onClick={() => setTab('journal')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 2h10v10H2z" />
          <line x1="4" y1="5" x2="10" y2="5" />
          <line x1="4" y1="7" x2="10" y2="7" />
          <line x1="4" y1="9" x2="7" y2="9" />
        </svg>
      </button>
      <button className={styles.btn} title="AI Agent (Ctrl+K)" onClick={() => setTab('ai')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="5" r="3" />
          <path d="M2 13c0-2.76 2.24-5 5-5s5 2.24 5 5" />
          <line x1="5" y1="5" x2="5" y2="5.01" strokeWidth="2" />
          <line x1="9" y1="5" x2="9" y2="5.01" strokeWidth="2" />
          <path d="M5 6.5c.5.5 1.5.5 2 0" />
        </svg>
      </button>
      <button className={styles.btn} title="Volatility Profile (7)" onClick={() => setTab('volt')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="8,1 4,7 7,7 6,13 10,7 7,7 8,1" />
        </svg>
      </button>
      <div className={styles.divider} />
      <button className={styles.btn} title="Settings" onClick={() => setSettingsOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="2" />
          <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M2.93 11.07l1.06-1.06M10.01 3.99l1.06-1.06" />
        </svg>
      </button>
    </nav>
  )
}
