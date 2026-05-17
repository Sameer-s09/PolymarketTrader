import { create } from 'zustand'
import type { Candle, WindowState, Signals } from '../types/candle'
import type { MarketData } from '../types/market'

export type RightPanelTab = 'market' | 'signals' | 'trades' | 'journal' | 'news' | 'ai' | 'volt' | 'alerts'
export type MainTab = 'c1c5' | 'btcfade'

export interface HourStats {
  hour:        number
  maxCandle:   number
  avgCandle:   number
  maxWindow:   number
  avgWindow:   number
  candleCount: number
  windowCount: number
}

export interface AlertRecord {
  id: number
  ts: number          // unix ms
  title: string
  body: string
}
export type WsStatus = 'connecting' | 'connected' | 'disconnected'

export interface Trade {
  id: number
  created_at: string
  resolved_at: string | null
  direction: 'UP' | 'DOWN'
  stake: number
  odds_up: number
  odds_down: number
  payout: number
  market_slug: string
  market_end_time: string
  candle_num: number
  btc_price: number
  pct_from_c1: number | null
  body_pct_prev: number | null
  signal_score: number | null
  c1_open: number | null
  session: string | null
  outcome: 'WIN' | 'LOSS' | null
  pnl: number | null
  resolution_price: number | null
  notes: string | null
}

export interface TradeStats {
  total: number
  wins: number
  losses: number
  open: number
  net_pnl: number
  win_rate: number
}

export interface JournalEntry {
  id: number
  created_at: string
  entry_type: 'note' | 'trade_note' | 'setup' | 'review'
  text: string
  tags: string[]
  btc_price: number | null
  candle_num: number | null
  session: string | null
  odds_up: number | null
  odds_down: number | null
  pct_from_c1: number | null
  trade_id: number | null
  trade_outcome: 'WIN' | 'LOSS' | null
  trade_pnl: number | null
}

export interface NewsItem {
  id: string
  source: string
  headline: string
  url: string
  publishedAt: string
  impact: 'HIGH' | 'MED' | 'LOW'
  sentiment: 'bullish' | 'bearish' | 'neutral'
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isProactive?: boolean
  timestamp: number
}

export interface AppSettings {
  defaultStake: number
  virtualBalance: number
  proactiveMode: boolean
  proactiveMinScore: number
  showBodyPct: boolean
  showOddsChips: boolean
  showCLabels: boolean
  showSessionBands: { asia: boolean; london: boolean; overlap: boolean; ny: boolean }
  // Masked API keys
  claudeApiKey: string
  cryptoPanicApiKey: string
  finnhubApiKey: string
}

interface AppState {
  // Price
  candles: Candle[]
  currentCandle: Candle | null

  // Window & signals
  windowState: WindowState | null
  signals: Signals | null

  // Polymarket
  market: MarketData | null

  // Trades
  trades: Trade[]
  tradeStats: TradeStats | null

  // Journal
  journalEntries: JournalEntry[]

  // News
  newsItems: NewsItem[]

  // AI
  chatHistory: ChatMessage[]
  isAIStreaming: boolean
  proactiveAlerts: ChatMessage[]

  // Settings
  settings: AppSettings | null

  // UI
  mainTab: MainTab
  rightPanelTab: RightPanelTab
  wsStatus: WsStatus
  settingsOpen: boolean

  // Volatility profile (hour-by-hour historical stats, loaded once on startup)
  voltProfile: HourStats[] | null
  setVoltProfile: (profile: HourStats[]) => void

  // Alert flashes (in-app toast, auto-dismisses)
  alertFlashes: { id: number; title: string; body: string }[]
  addAlertFlash: (title: string, body: string) => void
  dismissAlertFlash: (id: number) => void

  // Alert history (persistent log, newest first, max 200)
  alertHistory: AlertRecord[]
  clearAlertHistory: () => void

  // Actions
  addCandles: (candles: Candle[]) => void
  updateCandle: (candle: Candle, windowState: WindowState, signals: Signals) => void
  setMarket: (market: MarketData | null) => void
  setTrades: (trades: Trade[], stats: TradeStats) => void
  addTrade: (trade: Trade) => void
  setJournalEntries: (entries: JournalEntry[]) => void
  addJournalEntry: (entry: JournalEntry) => void
  setNewsItems: (items: NewsItem[]) => void
  setChatHistory: (msgs: ChatMessage[]) => void
  addChatMessage: (msg: ChatMessage) => void
  updateLastAssistantMessage: (delta: string) => void
  finalizeLastAssistantMessage: (fullContent: string) => void
  setIsAIStreaming: (v: boolean) => void
  addProactiveAlert: (msg: ChatMessage) => void
  setSettings: (s: AppSettings) => void
  setMainTab: (tab: MainTab) => void
  setRightPanelTab: (tab: RightPanelTab) => void
  setWsStatus: (status: WsStatus) => void
  setSettingsOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  candles: [],
  currentCandle: null,
  windowState: null,
  signals: null,
  market: null,
  trades: [],
  tradeStats: null,
  journalEntries: [],
  newsItems: [],
  chatHistory: [],
  isAIStreaming: false,
  proactiveAlerts: [],
  settings: null,
  voltProfile: null,
  setVoltProfile: (profile) => set({ voltProfile: profile }),

  mainTab: 'c1c5' as MainTab,
  rightPanelTab: 'market',
  wsStatus: 'connecting',
  settingsOpen: false,
  alertFlashes: [],
  addAlertFlash: (title, body) => set((state) => {
    const id  = Date.now() + Math.random()
    const rec = { id, ts: Date.now(), title, body }
    return {
      alertFlashes:  [...state.alertFlashes,  { id, title, body }].slice(-5),
      alertHistory:  [rec, ...state.alertHistory].slice(0, 200),
    }
  }),
  dismissAlertFlash: (id) => set((state) => ({
    alertFlashes: state.alertFlashes.filter((f) => f.id !== id),
  })),
  alertHistory: [],
  clearAlertHistory: () => set({ alertHistory: [] }),

  addCandles: (candles) => set({ candles }),

  updateCandle: (candle, windowState, signals) =>
    set((state) => {
      if (candle.isComplete) {
        const existing = state.candles.findIndex((c) => c.time === candle.time)
        const candles = existing >= 0
          ? state.candles.map((c, i) => (i === existing ? candle : c))
          : [...state.candles, candle]
        return { candles, currentCandle: null, windowState, signals }
      } else {
        return { currentCandle: candle, windowState, signals }
      }
    }),

  setMarket: (market) => set({ market }),

  setTrades: (trades, stats) => set({ trades, tradeStats: stats }),

  addTrade: (trade) => set((state) => ({
    trades: [trade, ...state.trades],
  })),

  setJournalEntries: (entries) => set({ journalEntries: entries }),

  addJournalEntry: (entry) => set((state) => ({
    journalEntries: [entry, ...state.journalEntries],
  })),

  setNewsItems: (items) => set({ newsItems: items }),

  setChatHistory: (msgs) => set({ chatHistory: msgs }),

  addChatMessage: (msg) => set((state) => ({
    chatHistory: [...state.chatHistory, msg],
  })),

  updateLastAssistantMessage: (delta) => set((state) => {
    const history = [...state.chatHistory]
    const last = history[history.length - 1]
    if (last && last.role === 'assistant' && last.isStreaming) {
      history[history.length - 1] = { ...last, content: last.content + delta }
    }
    return { chatHistory: history }
  }),

  finalizeLastAssistantMessage: (fullContent) => set((state) => {
    const history = [...state.chatHistory]
    const last = history[history.length - 1]
    if (last && last.role === 'assistant') {
      history[history.length - 1] = { ...last, content: fullContent, isStreaming: false }
    }
    return { chatHistory: history }
  }),

  setIsAIStreaming: (v) => set({ isAIStreaming: v }),

  addProactiveAlert: (msg) => set((state) => ({
    proactiveAlerts: [msg, ...state.proactiveAlerts].slice(0, 3),
  })),

  setSettings: (s) => set({ settings: s }),

  setMainTab: (tab) => set({ mainTab: tab }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}))
