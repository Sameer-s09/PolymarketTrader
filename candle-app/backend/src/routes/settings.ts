import { Router } from 'express'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const router = Router()
const SETTINGS_PATH = join(process.cwd(), 'settings.json')

export interface AppSettings {
  defaultStake: number
  virtualBalance: number
  proactiveMode: boolean
  proactiveMinScore: number
  showBodyPct: boolean
  showOddsChips: boolean
  showCLabels: boolean
  showSessionBands: {
    asia: boolean
    london: boolean
    overlap: boolean
    ny: boolean
  }
  // API keys (stored server-side only, never sent to client in full)
  claudeApiKey: string
  cryptoPanicApiKey: string
  finnhubApiKey: string
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultStake: 5,
  virtualBalance: 100,
  proactiveMode: false,
  proactiveMinScore: 6,
  showBodyPct: true,
  showOddsChips: true,
  showCLabels: true,
  showSessionBands: { asia: true, london: true, overlap: true, ny: true },
  claudeApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  cryptoPanicApiKey: process.env.CRYPTOPANIC_API_KEY ?? '',
  finnhubApiKey: process.env.FINNHUB_API_KEY ?? '',
}

function loadSettings(): AppSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = readFileSync(SETTINGS_PATH, 'utf8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(s: AppSettings) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8')
}

let settings = loadSettings()

export function getSettings(): AppSettings {
  return settings
}

// Mask API keys before sending to client
function maskSettings(s: AppSettings) {
  const mask = (k: string) => k ? `${k.slice(0, 4)}${'*'.repeat(Math.max(0, k.length - 8))}${k.slice(-4)}` : ''
  return {
    ...s,
    claudeApiKey: mask(s.claudeApiKey),
    cryptoPanicApiKey: mask(s.cryptoPanicApiKey),
    finnhubApiKey: mask(s.finnhubApiKey),
  }
}

router.get('/', (_req, res) => {
  res.json(maskSettings(settings))
})

router.put('/', (req, res) => {
  const body = req.body as Partial<AppSettings>

  // Only update API keys if they're unmasked (no asterisks)
  const newSettings = { ...settings }

  for (const [k, v] of Object.entries(body)) {
    if (k === 'claudeApiKey' || k === 'cryptoPanicApiKey' || k === 'finnhubApiKey') {
      // Only update if it's a real key (not masked)
      if (typeof v === 'string' && !v.includes('*') && v.length > 0) {
        (newSettings as Record<string, unknown>)[k] = v
      }
    } else {
      (newSettings as Record<string, unknown>)[k] = v
    }
  }

  settings = newSettings
  saveSettings(settings)
  res.json(maskSettings(settings))
})

export default router
