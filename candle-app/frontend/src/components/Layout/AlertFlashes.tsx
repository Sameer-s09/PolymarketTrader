import { useEffect } from 'react'
import { useAppStore } from '../../store'
import styles from './AlertFlashes.module.css'

export function AlertFlashes() {
  const flashes        = useAppStore((s) => s.alertFlashes)
  const dismissFlash   = useAppStore((s) => s.dismissAlertFlash)

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (flashes.length === 0) return
    const oldest = flashes[0]
    const timer = setTimeout(() => dismissFlash(oldest.id), 6000)
    return () => clearTimeout(timer)
  }, [flashes, dismissFlash])

  if (flashes.length === 0) return null

  return (
    <div className={styles.stack}>
      {flashes.map((f) => (
        <div key={f.id} className={styles.flash} onClick={() => dismissFlash(f.id)}>
          <span className={styles.title}>{f.title}</span>
          <span className={styles.body}>{f.body}</span>
        </div>
      ))}
    </div>
  )
}
