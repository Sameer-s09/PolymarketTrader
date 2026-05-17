export interface FibLevels {
  fib382: number
  fib500: number
  fib618: number
}

export type FibState = 'testing' | 'broken' | 'clear'

export interface FibProximity {
  fib382: FibState
  fib618: FibState
  fib382Price: number
  fib618Price: number
}

const PROXIMITY_PCT = 0.0015 // 0.15%

export function computeFibLevels(high: number, low: number, direction: 'bull' | 'bear'): FibLevels {
  const range = high - low
  const anchor = direction === 'bull' ? high : low
  const sign = direction === 'bull' ? -1 : 1

  return {
    fib382: anchor + range * 0.382 * sign,
    fib500: anchor + range * 0.500 * sign,
    fib618: anchor + range * 0.618 * sign,
  }
}

function getFibState(price: number, fibPrice: number): FibState {
  const pct = Math.abs(price - fibPrice) / fibPrice
  if (pct <= PROXIMITY_PCT) return 'testing'
  // "broken" means price has gone past the level (direction-agnostic simplified check)
  return 'clear'
}

export function computeFibProximity(
  currentPrice: number,
  high: number,
  low: number,
  direction: 'bull' | 'bear'
): FibProximity {
  if (high === 0 || low === 0 || high === low) {
    return { fib382: 'clear', fib618: 'clear', fib382Price: 0, fib618Price: 0 }
  }

  const levels = computeFibLevels(high, low, direction)

  return {
    fib382: getFibState(currentPrice, levels.fib382),
    fib618: getFibState(currentPrice, levels.fib618),
    fib382Price: levels.fib382,
    fib618Price: levels.fib618,
  }
}
