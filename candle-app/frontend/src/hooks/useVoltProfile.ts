import { useEffect } from 'react'
import { useAppStore } from '../store'

export function useVoltProfile() {
  const setVoltProfile = useAppStore((s) => s.setVoltProfile)

  useEffect(() => {
    fetch('/api/volatility/profile')
      .then((r) => r.json())
      .then((json: { profile: Parameters<typeof setVoltProfile>[0] }) => {
        if (Array.isArray(json?.profile)) setVoltProfile(json.profile)
      })
      .catch(() => { /* non-fatal — overlay just won't show hour stats */ })
  }, [setVoltProfile])
}
