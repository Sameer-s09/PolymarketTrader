const WebSocket = require('ws')
const ws = new WebSocket('ws://localhost:3002')
let msgCount = 0
let candleTicks = 0

ws.on('open', () => console.log('[test] connected to broadcaster port 3002'))

ws.on('message', (raw) => {
  msgCount++
  const msg = JSON.parse(raw.toString())
  if (msg.type === 'connected') {
    console.log('[test] got: connected handshake')
  } else if (msg.type === 'backfill') {
    console.log(`[test] got: backfill (${msg.data.candles.length} candles, last close=${msg.data.candles.at(-1)?.close})`)
  } else if (msg.type === 'candle') {
    candleTicks++
    console.log(`[test] LIVE TICK #${candleTicks}: close=${msg.data.close} isComplete=${msg.data.isComplete}`)
    if (candleTicks >= 3) { ws.close(); process.exit(0) }
  } else {
    console.log(`[test] unknown type: ${msg.type}`)
  }
})

ws.on('error', e => { console.error('[test] ERROR:', e.message); process.exit(1) })
ws.on('close', () => console.log('[test] closed'))

setTimeout(() => {
  console.log(`[test] Timeout — ${msgCount} total msgs, ${candleTicks} live ticks`)
  process.exit(1)
}, 20000)
