import { useWebSocket } from './hooks/useWebSocket'
import { usePolymarket } from './hooks/usePolymarket'
import { useAlerts } from './hooks/useAlerts'
import { useVoltProfile } from './hooks/useVoltProfile'
import { TopBar, useAlertsToggle } from './components/Layout/TopBar'
import { NavBar } from './components/Layout/NavBar'
import { RightPanel } from './components/Layout/RightPanel'
import { BottomBar } from './components/Layout/BottomBar'
import { CandleChart } from './components/Chart/CandleChart'
import { SettingsPanel } from './components/Layout/SettingsPanel'
import { AlertFlashes } from './components/Layout/AlertFlashes'
import { BtcFadeView } from './components/BtcFade/BtcFadeView'
import { useAppStore } from './store'
import styles from './App.module.css'

export function App() {
  useWebSocket()
  usePolymarket()
  useVoltProfile()
  const { sizeBreakout, trendAligned, bigCandle, windowBreakout, toggleSize, toggleTrend, toggleBig, toggleWin } = useAlertsToggle()
  useAlerts(sizeBreakout, trendAligned, bigCandle, windowBreakout)
  const mainTab = useAppStore((s) => s.mainTab)

  return (
    <div className={styles.shell}>
      <TopBar
        sizeBreakout={sizeBreakout}
        trendAligned={trendAligned}
        bigCandle={bigCandle}
        windowBreakout={windowBreakout}
        toggleSize={toggleSize}
        toggleTrend={toggleTrend}
        toggleBig={toggleBig}
        toggleWin={toggleWin}
      />
      {mainTab === 'c1c5' ? (
        <>
          <div className={styles.body}>
            <NavBar />
            <div className={styles.chartArea}>
              <CandleChart />
            </div>
            <RightPanel />
          </div>
          <BottomBar />
        </>
      ) : (
        <div className={styles.body}>
          <BtcFadeView />
        </div>
      )}
      <SettingsPanel />
      <AlertFlashes />
    </div>
  )
}
