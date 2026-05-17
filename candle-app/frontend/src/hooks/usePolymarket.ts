import { useEffect } from 'react'
import { useAppStore } from '../store'
import type { MarketData } from '../types/market'

const POLL_INTERVAL = 1_000

export function usePolymarket() {
  const setMarket = useAppStore((s) => s.setMarket)

  useEffect(() => {
    async function fetch() {
      try {
        const res = await window.fetch('/api/polymarket/current')
        if (!res.ok) return
        const data = await res.json() as MarketData
        setMarket(data)
      } catch {
        // ignore
      }
    }

    fetch()
    const id = setInterval(fetch, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [setMarket])
}
