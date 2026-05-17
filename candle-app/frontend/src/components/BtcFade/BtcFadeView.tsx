import { useState } from 'react'
import { BtcFadeChart }   from './BtcFadeChart'
import { BtcFadeJournal } from './BtcFadeJournal'
import styles from './BtcFadeView.module.css'

type SubTab = 'chart' | 'journal'

export function BtcFadeView() {
  const [sub, setSub] = useState<SubTab>('chart')

  return (
    <div className={styles.view}>
      {/* Sub-tab bar */}
      <div className={styles.subTabBar}>
        <button
          className={`${styles.subTab} ${sub === 'chart' ? styles.subTabActive : ''}`}
          onClick={() => setSub('chart')}
        >
          15m Chart
        </button>
        <button
          className={`${styles.subTab} ${sub === 'journal' ? styles.subTabActive : ''}`}
          onClick={() => setSub('journal')}
        >
          Journal
        </button>
        <div className={styles.subTabSpacer} />
        <span className={styles.subTabHint}>
          <span style={{ color: '#e3b341' }}>▲▼</span> S4 &nbsp;
          <span style={{ color: '#00d4ff' }}>▲▼</span> S5 — markers on last streak candle
        </span>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {sub === 'chart'   && <BtcFadeChart />}
        {sub === 'journal' && <BtcFadeJournal />}
      </div>
    </div>
  )
}
