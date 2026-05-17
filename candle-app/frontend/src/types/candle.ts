export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  isComplete: boolean
}

export interface WindowState {
  candleNum: number
  windowOpen: number
  windowHigh: number
  windowLow: number
  pctFromC1: number
  isLastInWindow: boolean
  c1Open: number
  windowStartTime: number
}

export interface FibProximity {
  fib382: 'testing' | 'broken' | 'clear'
  fib618: 'testing' | 'broken' | 'clear'
  fib382Price: number
  fib618Price: number
}

export interface Signals {
  score: number
  label: 'BULL SETUP' | 'BEAR SETUP' | 'MIXED' | 'WEAK'
  direction: 'bull' | 'bear' | null
  session: 'asia' | 'london' | 'overlap' | 'ny' | 'off'
  bodyPctPrev: number
  pctFromC1: number
  candleNum: number
  fibProximity: FibProximity | null
}

export interface CandleMessage {
  type: 'candle'
  data: Candle & {
    windowState: WindowState
    signals: Signals
  }
}

export interface BackfillMessage {
  type: 'backfill'
  data: { candles: Candle[] }
}

export interface ConnectedMessage {
  type: 'connected'
  data: { timestamp: number }
}

export interface WindowCompleteMessage {
  type: 'window_complete'
  data: {
    windowOpen: number
    windowClose: number
    windowHigh: number
    windowLow: number
    direction: 'UP' | 'DOWN'
    bodyPct: number
    startTime: number
    endTime: number
  }
}

export type WsMessage = CandleMessage | BackfillMessage | ConnectedMessage | WindowCompleteMessage
