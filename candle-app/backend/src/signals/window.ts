import type { Candle } from '../ws/bitstamp'

export interface WindowState {
  candleNum: number
  windowStartTime: number
  c1Open: number
  windowHigh: number
  windowLow: number
  windowOpen: number
  windowClose: number
  pctFromC1: number
  isLastInWindow: boolean
  prevWindowBodyPct: number
  prevWindowHigh: number
  prevWindowLow: number
  prevWindowOpen: number
  prevWindowClose: number
  prevWindowDirection: 'bull' | 'bear' | null
}

const WINDOW_SECONDS = 900  // 15 minutes
const CANDLE_SECONDS = 180  // 3 minutes

const state: WindowState = {
  candleNum: 1,
  windowStartTime: 0,
  c1Open: 0,
  windowHigh: 0,
  windowLow: Infinity,
  windowOpen: 0,
  windowClose: 0,
  pctFromC1: 0,
  isLastInWindow: false,
  prevWindowBodyPct: 0,
  prevWindowHigh: 0,
  prevWindowLow: 0,
  prevWindowOpen: 0,
  prevWindowClose: 0,
  prevWindowDirection: null,
}

export function updateWindowState(candle: Candle): WindowState {
  const candleNum = Math.floor((candle.time % WINDOW_SECONDS) / CANDLE_SECONDS) + 1
  const windowStartTime = Math.floor(candle.time / WINDOW_SECONDS) * WINDOW_SECONDS

  // New window started
  if (candleNum === 1 && windowStartTime !== state.windowStartTime) {
    // Archive previous window
    if (state.windowStartTime !== 0) {
      const range = state.windowHigh - state.windowLow
      state.prevWindowBodyPct = range > 0
        ? Math.abs(state.windowClose - state.windowOpen) / range * 100
        : 0
      state.prevWindowHigh = state.windowHigh
      state.prevWindowLow = state.windowLow
      state.prevWindowOpen = state.windowOpen
      state.prevWindowClose = state.windowClose
      state.prevWindowDirection = state.windowClose >= state.windowOpen ? 'bull' : 'bear'
    }

    // Reset current window
    state.windowStartTime = windowStartTime
    state.c1Open = candle.open
    state.windowOpen = candle.open
    state.windowHigh = candle.high
    state.windowLow = candle.low
  } else if (windowStartTime === state.windowStartTime || state.windowStartTime === 0) {
    if (state.windowStartTime === 0) {
      state.windowStartTime = windowStartTime
      state.c1Open = candle.open
      state.windowOpen = candle.open
      state.windowHigh = candle.high
      state.windowLow = candle.low
    } else {
      state.windowHigh = Math.max(state.windowHigh, candle.high)
      state.windowLow = Math.min(state.windowLow, candle.low)
    }
  }

  state.candleNum = candleNum
  state.windowClose = candle.close
  state.pctFromC1 = state.c1Open > 0
    ? (candle.close - state.c1Open) / state.c1Open * 100
    : 0
  state.isLastInWindow = candleNum === 5

  return { ...state }
}

export function getWindowState(): WindowState {
  return { ...state }
}
