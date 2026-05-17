export interface MarketData {
  slug: string
  question: string
  oddsUp: number
  oddsDown: number
  payoutUp: number
  payoutDown: number
  volume: number
  liquidity: number
  endTime: string
  startTime: string
  active: boolean
  closed: boolean
  lastUpdated: string
}
