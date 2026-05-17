import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import './db/index'  // run migrations on startup
import { startBitstampClient } from './ws/bitstamp'
import { startBroadcaster } from './ws/broadcaster'
import polymarketRouter from './routes/polymarket'
import tradesRouter from './routes/trades'
import journalRouter from './routes/journal'
import newsRouter from './routes/news'
import aiRouter from './routes/ai'
import settingsRouter from './routes/settings'
import chatRouter from './routes/chat'
import volatilityRouter from './routes/volatility'
import btcfadeRouter from './routes/btcfade'

const PORT = Number(process.env.PORT ?? 3001)
const IS_PROD = process.env.NODE_ENV === 'production'

const app = express()

// In prod, allow same-origin requests from Nginx; in dev, allow localhost
app.use(cors({
  origin: IS_PROD
    ? false  // Nginx handles CORS — same origin only
    : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
}))
app.use(express.json({ limit: '5mb' }))  // allow chart screenshots

app.use('/api/polymarket', polymarketRouter)
app.use('/api/trades', tradesRouter)
app.use('/api/journal', journalRouter)
app.use('/api/news', newsRouter)
app.use('/api/ai', aiRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/chat', chatRouter)
app.use('/api/volatility', volatilityRouter)
app.use('/api/btcfade', btcfadeRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() })
})

// Serve built frontend in production
if (IS_PROD) {
  const distPath = path.resolve(__dirname, '../../frontend/dist')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

const server = app.listen(PORT, async () => {
  console.log(`[server] backend on :${PORT}`)
  await startBitstampClient()
  startBroadcaster()
})

// Graceful shutdown so tsx watch hot-reload doesn't hit EADDRINUSE
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
