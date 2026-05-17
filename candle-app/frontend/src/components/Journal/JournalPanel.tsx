import { useEffect, useRef, useState } from 'react'
import { useAppStore, type JournalEntry } from '../../store'
import styles from './JournalPanel.module.css'

type EntryType = 'note' | 'trade_note' | 'setup' | 'review'

function useJournal() {
  const { journalEntries, setJournalEntries, addJournalEntry, market, windowState } = useAppStore((s) => ({
    journalEntries: s.journalEntries,
    setJournalEntries: s.setJournalEntries,
    addJournalEntry: s.addJournalEntry,
    market: s.market,
    windowState: s.windowState,
  }))

  const refresh = async () => {
    try {
      const r = await fetch('/api/journal?limit=50')
      if (!r.ok) return
      const d = await r.json() as { entries: JournalEntry[] }
      setJournalEntries(d.entries)
    } catch {}
  }

  useEffect(() => {
    refresh()
    // Poll every 30s — catches backend restarts + entries added in other tabs
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [])

  const submit = async (text: string, entryType: EntryType) => {
    if (!text.trim()) return
    try {
      const r = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), entryType }),
      })
      if (!r.ok) return
      const entry = await r.json() as JournalEntry
      entry.tags = entry.tags ?? []
      addJournalEntry(entry)
    } catch {}
  }

  return { journalEntries, submit, market, windowState }
}

const TYPE_LABELS: Record<EntryType, string> = {
  note: 'NOTE',
  trade_note: 'TRADE',
  setup: 'SETUP',
  review: 'REVIEW',
}
const TYPE_COLORS: Record<EntryType, string> = {
  note: '#3a7fd4',
  trade_note: '#d4a830',
  setup: '#22c97a',
  review: '#3a7fd4',
}

function EntryCard({ entry }: { entry: JournalEntry }) {
  const color = TYPE_COLORS[entry.entry_type]
  return (
    <div className={styles.entryCard}>
      <div className={styles.entryHeader}>
        <span className={styles.entryType} style={{ color }}>{TYPE_LABELS[entry.entry_type]}</span>
        {entry.candle_num && <span className={styles.entryMeta}>C{entry.candle_num}</span>}
        {entry.btc_price && <span className={styles.entryMeta}>${entry.btc_price.toFixed(0)}</span>}
        {entry.odds_up && <span className={styles.entryMeta}>{Math.round(entry.odds_up * 100)}%↑</span>}
        {entry.trade_outcome && (
          <span className={`${styles.entryOutcome} ${entry.trade_outcome === 'WIN' ? styles.win : styles.loss}`}>
            {entry.trade_outcome} {entry.trade_pnl != null ? `${entry.trade_pnl >= 0 ? '+' : ''}${entry.trade_pnl.toFixed(2)}` : ''}
          </span>
        )}
        <span className={styles.entryTime}>
          {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className={styles.entryText}>{entry.text}</div>
      {entry.tags && entry.tags.length > 0 && (
        <div className={styles.entryTags}>
          {entry.tags.map((tag) => <span key={tag} className={styles.tag}>{tag}</span>)}
        </div>
      )}
    </div>
  )
}

export function JournalPanel() {
  const { journalEntries, submit, market, windowState } = useJournal()
  const [text, setText] = useState('')
  const [entryType, setEntryType] = useState<EntryType>('note')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    await submit(text, entryType)
    setText('')
    setSaving(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  // Listen for J shortcut focus event
  useEffect(() => {
    const handler = () => inputRef.current?.focus()
    document.addEventListener('focus-journal-input', handler)
    return () => document.removeEventListener('focus-journal-input', handler)
  }, [])

  return (
    <div className={styles.panel}>
      {/* Quick capture bar */}
      <div className={styles.captureBar}>
        <div className={styles.contextChips}>
          {windowState?.candleNum && <span className={styles.chip}>C{windowState.candleNum}</span>}
          {market && <span className={styles.chip}>{Math.round(market.oddsUp * 100)}%↑</span>}
          {windowState?.pctFromC1 != null && (
            <span className={`${styles.chip} ${windowState.pctFromC1 >= 0 ? styles.pos : styles.neg}`}>
              {windowState.pctFromC1 >= 0 ? '+' : ''}{windowState.pctFromC1.toFixed(2)}%
            </span>
          )}
        </div>
        <textarea
          ref={inputRef}
          className={styles.captureInput}
          placeholder="Note your observation… (Enter to save)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <div className={styles.captureActions}>
          <div className={styles.typeButtons}>
            {(Object.keys(TYPE_LABELS) as EntryType[]).map((t) => (
              <button
                key={t}
                className={`${styles.typeBtn} ${entryType === t ? styles.active : ''}`}
                style={entryType === t ? { borderColor: TYPE_COLORS[t], color: TYPE_COLORS[t] } : {}}
                onClick={() => setEntryType(t)}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <button className={styles.saveBtn} onClick={handleSubmit} disabled={!text.trim() || saving}>
            {saving ? '…' : 'SAVE'}
          </button>
        </div>
      </div>

      {/* Entry timeline */}
      <div className={styles.timeline}>
        {journalEntries.length === 0 ? (
          <div className={styles.empty}>No entries yet. Write your first observation above.</div>
        ) : (
          journalEntries.map((e) => <EntryCard key={e.id} entry={e} />)
        )}
      </div>
    </div>
  )
}
