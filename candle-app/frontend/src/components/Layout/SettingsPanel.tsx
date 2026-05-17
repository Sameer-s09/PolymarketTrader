import { useEffect, useState } from 'react'
import { useAppStore, type AppSettings } from '../../store'
import styles from './SettingsPanel.module.css'

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen, settings, setSettings } = useAppStore((s) => ({
    settingsOpen: s.settingsOpen,
    setSettingsOpen: s.setSettingsOpen,
    settings: s.settings,
    setSettings: s.setSettings,
  }))

  const [form, setForm] = useState<Partial<AppSettings & { claudeApiKeyInput: string; finnhubApiKeyInput: string }>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) {
      fetch('/api/settings')
        .then((r) => r.json())
        .then((s: AppSettings) => {
          setSettings(s)
          setForm({ ...s, claudeApiKeyInput: '', finnhubApiKeyInput: '' })
        })
        .catch(() => {})
    } else {
      setForm({ ...settings, claudeApiKeyInput: '', finnhubApiKeyInput: '' })
    }
  }, [settings, settingsOpen])

  const save = async () => {
    setSaving(true)
    const body: Partial<AppSettings> = { ...form }
    // Map input fields to actual key fields if provided
    if (form.claudeApiKeyInput) body.claudeApiKey = form.claudeApiKeyInput
    if (form.finnhubApiKeyInput) body.finnhubApiKey = form.finnhubApiKeyInput
    delete (body as Record<string, unknown>).claudeApiKeyInput
    delete (body as Record<string, unknown>).finnhubApiKeyInput

    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        const updated = await r.json() as AppSettings
        setSettings(updated)
      }
    } catch {}
    setSaving(false)
  }

  if (!settingsOpen) return null

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const setBand = (k: 'asia' | 'london' | 'overlap' | 'ny', v: boolean) =>
    setForm((f) => ({
      ...f,
      showSessionBands: { ...(f.showSessionBands ?? { asia: true, london: true, overlap: true, ny: true }), [k]: v },
    }))

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false) }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>SETTINGS</span>
          <button className={styles.closeBtn} onClick={() => setSettingsOpen(false)}>✕</button>
        </div>

        <div className={styles.body}>
          {/* API Keys */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>API KEYS</div>
            <div className={styles.hint}>News feeds use free RSS. Finnhub unlocks the economic calendar.</div>
            <div className={styles.row}>
              <label className={styles.label}>Claude API Key</label>
              <div className={styles.keyRow}>
                <span className={styles.masked}>{settings?.claudeApiKey || '(not set)'}</span>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="sk-ant-…"
                  value={form.claudeApiKeyInput ?? ''}
                  onChange={(e) => set('claudeApiKeyInput', e.target.value)}
                />
              </div>
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Finnhub API Key</label>
              <div className={styles.keyRow}>
                <span className={styles.masked}>{settings?.finnhubApiKey || '(not set)'}</span>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="…"
                  value={form.finnhubApiKeyInput ?? ''}
                  onChange={(e) => set('finnhubApiKeyInput', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Trading defaults */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>TRADING</div>
            <div className={styles.row}>
              <label className={styles.label}>Default Stake ($)</label>
              <input
                className={styles.inputSmall}
                type="number"
                min={0.1}
                step={0.5}
                value={form.defaultStake ?? 5}
                onChange={(e) => set('defaultStake', parseFloat(e.target.value))}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Starting Balance ($)</label>
              <input
                className={styles.inputSmall}
                type="number"
                min={1}
                step={10}
                value={form.virtualBalance ?? 100}
                onChange={(e) => set('virtualBalance', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* AI settings */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>AI AGENT</div>
            <div className={styles.row}>
              <label className={styles.label}>Proactive Mode</label>
              <button
                className={`${styles.toggle} ${form.proactiveMode ? styles.on : ''}`}
                onClick={() => set('proactiveMode', !form.proactiveMode)}
              >
                {form.proactiveMode ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className={styles.row}>
              <label className={styles.label}>Min Signal Score</label>
              <input
                className={styles.inputSmall}
                type="number"
                min={1}
                max={10}
                value={form.proactiveMinScore ?? 6}
                onChange={(e) => set('proactiveMinScore', parseInt(e.target.value))}
              />
            </div>
          </div>

          {/* Chart display */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>CHART DISPLAY</div>
            {[
              ['showBodyPct', 'Body%'],
              ['showOddsChips', 'Odds chips'],
              ['showCLabels', 'C1–C5 labels'],
            ].map(([key, label]) => (
              <div key={key} className={styles.row}>
                <label className={styles.label}>{label}</label>
                <button
                  className={`${styles.toggle} ${form[key as keyof typeof form] ? styles.on : ''}`}
                  onClick={() => set(key as keyof typeof form, !form[key as keyof typeof form] as never)}
                >
                  {form[key as keyof typeof form] ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
          </div>

          {/* Session bands */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>SESSION BANDS</div>
            {(['asia', 'london', 'overlap', 'ny'] as const).map((s) => (
              <div key={s} className={styles.row}>
                <label className={styles.label}>{s.toUpperCase()}</label>
                <button
                  className={`${styles.toggle} ${(form.showSessionBands?.[s] ?? true) ? styles.on : ''}`}
                  onClick={() => setBand(s, !(form.showSessionBands?.[s] ?? true))}
                >
                  {(form.showSessionBands?.[s] ?? true) ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={() => setSettingsOpen(false)}>Cancel</button>
          <button className={styles.saveBtn} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
