export type Session = 'asia' | 'london' | 'overlap' | 'ny' | 'off'

export interface SessionBand {
  session: Session
  startHour: number
  endHour: number
}

export const SESSION_BANDS: SessionBand[] = [
  { session: 'asia',    startHour: 0,  endHour: 8  },
  { session: 'london',  startHour: 8,  endHour: 16 },
  { session: 'overlap', startHour: 13, endHour: 16 },
  { session: 'ny',      startHour: 13, endHour: 21 },
]

export const SESSION_EVENTS = {
  londonFix:        { hour: 11, minute: 0  },
  nyEquityOpen:     { hour: 14, minute: 30 },
  cmeFuturesSettle: { hour: 21, minute: 0  },
}

export function getCurrentSession(utcTimestamp: number): Session {
  const d = new Date(utcTimestamp * 1000)
  const totalMinutes = d.getUTCHours() * 60 + d.getUTCMinutes()

  const isOverlap = totalMinutes >= 780 && totalMinutes < 960
  const isLondon  = totalMinutes >= 480 && totalMinutes < 960
  const isNY      = totalMinutes >= 780 && totalMinutes < 1260
  const isAsia    = totalMinutes >= 0   && totalMinutes < 480

  if (isOverlap) return 'overlap'
  if (isLondon)  return 'london'
  if (isNY)      return 'ny'
  if (isAsia)    return 'asia'
  return 'off'
}
