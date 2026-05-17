import styles from './BottomBar.module.css'

export function BottomBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${styles.active}`}>Chart</button>
        <button className={styles.tab}>Signals</button>
        <button className={styles.tab}>Mock Trades</button>
        <button className={styles.tab}>News</button>
        <button className={styles.tab}>Journal</button>
      </div>
      <div className={styles.log}>
        <span className={styles.logText}>● System ready</span>
      </div>
    </div>
  )
}
