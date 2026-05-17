import type { Session } from '../utils/sessions'
import type { WindowState } from './window'

export type SignalLabel = 'BULL SETUP' | 'BEAR SETUP' | 'MIXED' | 'WEAK'

export interface SignalResult {
  score: number
  label: SignalLabel
  direction: 'bull' | 'bear' | null
  bodyPctScore: number
  pctFromC1Score: number
  sessionScore: number
  oddsEdgeScore: number
}

function bodyPctScore(bodyPct: number): number {
  if (bodyPct > 80) return 4
  if (bodyPct > 65) return 3
  if (bodyPct > 50) return 2
  if (bodyPct > 30) return 1
  return 0
}

function pctFromC1Score(pctFromC1: number, direction: 'bull' | 'bear'): number {
  const signed = direction === 'bull' ? pctFromC1 : -pctFromC1
  if (signed > 0.3) return 2
  if (signed > 0.1) return 1
  return 0
}

function sessionScore(session: Session): number {
  switch (session) {
    case 'overlap': return 2
    case 'london':  return 1
    case 'ny':      return 1
    case 'asia':    return 0
    default:        return 0
  }
}

function oddsEdgeScore(oddsUp: number, oddsDown: number, direction: 'bull' | 'bear'): number {
  const implied = direction === 'bull' ? oddsUp * 100 : oddsDown * 100
  const edge = Math.abs(implied - 50)
  if (edge > 7) return 2
  if (edge > 3) return 1
  return 0
}

export function computeSignalScore(
  windowState: WindowState,
  session: Session,
  oddsUp: number,
  oddsDown: number,
): SignalResult {
  const direction: 'bull' | 'bear' = windowState.pctFromC1 >= 0 ? 'bull' : 'bear'

  const bScore = bodyPctScore(windowState.prevWindowBodyPct)
  const pScore = pctFromC1Score(windowState.pctFromC1, direction)
  const sScore = sessionScore(session)
  const oScore = oddsEdgeScore(oddsUp, oddsDown, direction)

  const total = bScore + pScore + sScore + oScore
  const score = Math.round(total)

  let label: SignalLabel
  if (score >= 7) {
    label = direction === 'bull' ? 'BULL SETUP' : 'BEAR SETUP'
  } else if (score >= 5) {
    label = 'MIXED'
  } else {
    label = 'WEAK'
  }

  return {
    score,
    label,
    direction,
    bodyPctScore: bScore,
    pctFromC1Score: pScore,
    sessionScore: sScore,
    oddsEdgeScore: oScore,
  }
}
