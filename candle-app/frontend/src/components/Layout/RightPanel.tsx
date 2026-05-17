import { useEffect, useRef, useState } from 'react'
import { useAppStore, type RightPanelTab } from '../../store'
import { MarketPanel } from '../Polymarket/MarketPanel'
import { SignalsPanel } from '../Signals/SignalsPanel'
import { TradesPanel } from '../Trades/TradesPanel'
import { JournalPanel } from '../Journal/JournalPanel'
import { NewsPanel } from '../News/NewsPanel'
import { AiPanel } from '../AI/AiPanel'
import { VoltPanel } from '../Volt/VoltPanel'
import { AlertsPanel } from '../Alerts/AlertsPanel'
import styles from './RightPanel.module.css'

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'market',  label: 'MKT'  },
  { id: 'signals', label: 'SIG'  },
  { id: 'trades',  label: 'TRAD' },
  { id: 'journal', label: 'JOUR' },
  { id: 'news',    label: 'NEWS' },
  { id: 'ai',      label: 'AI'   },
  { id: 'volt',    label: 'VOLT' },
  { id: 'alerts',  label: 'ALRT' },
]

const MIN_WIDTH = 220
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 280

export function RightPanel() {
  const tab = useAppStore((s) => s.rightPanelTab)
  const setTab = useAppStore((s) => s.setRightPanelTab)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth')
    return saved ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parseInt(saved))) : DEFAULT_WIDTH
  })
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true
    startX.current = e.clientX
    startW.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX.current - e.clientX   // dragging left = wider panel
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta))
      setWidth(newW)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem('rightPanelWidth', String(width))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [width])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'

      if (!isInput && !e.metaKey && !e.ctrlKey) {
        if (e.key === '1') { setTab('market'); return }
        if (e.key === '2') { setTab('signals'); return }
        if (e.key === '3') { setTab('trades'); return }
        if (e.key === '4') { setTab('journal'); return }
        if (e.key === '5') { setTab('news'); return }
        if (e.key === '6') { setTab('ai'); return }
        if (e.key === '7') { setTab('volt'); return }
        if (e.key === '8') { setTab('alerts'); return }

        if (e.key === 'j' || e.key === 'J') {
          setTab('journal')
          setTimeout(() => document.dispatchEvent(new CustomEvent('focus-journal-input')), 50)
          return
        }
        if (e.key === 'n' || e.key === 'N') { setTab('news'); return }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setTab('ai')
        setTimeout(() => window.dispatchEvent(new CustomEvent('focus-ai-input')), 50)
        return
      }

      if (e.key === 'Escape') setSettingsOpen(false)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setTab, setSettingsOpen])

  return (
    <div className={styles.panel} style={{ width }}>
      {/* Drag handle on the left edge */}
      <div className={styles.resizeHandle} onMouseDown={onMouseDown} title="Drag to resize" />

      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.active : ''} ${t.id === 'ai' && tab === 'ai' ? styles.aiActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {tab === 'market'  && <MarketPanel />}
        {tab === 'signals' && <SignalsPanel />}
        {tab === 'trades'  && <TradesPanel />}
        {tab === 'journal' && <JournalPanel />}
        {tab === 'news'    && <NewsPanel />}
        {tab === 'ai'      && <AiPanel />}
        {tab === 'volt'    && <VoltPanel />}
        {tab === 'alerts'  && <AlertsPanel />}
      </div>
    </div>
  )
}
