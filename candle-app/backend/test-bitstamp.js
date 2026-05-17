const WebSocket = require('ws')
console.log('[test] Connecting...')
const ws = new WebSocket('wss://ws.bitstamp.net')

ws.on('open', () => {
  console.log('[test] Connected! Subscribing to live_trades_btcusd...')
  ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: 'live_trades_btcusd' } }))
})

let msgCount = 0
ws.on('message', (raw) => {
  msgCount++
  const msg = JSON.parse(raw.toString())
  const dataStr = JSON.stringify(msg.data).substring(0, 300)
  console.log(`[msg ${msgCount}] event="${msg.event}" channel="${msg.channel || ''}" data=${dataStr}`)
  if (msgCount >= 8) { ws.close(); process.exit(0) }
})

ws.on('error', (err) => console.error('[test] ERROR:', err.message))
ws.on('close', () => console.log('[test] closed'))
setTimeout(() => { console.log(`[test] Timeout — ${msgCount} msgs received`); process.exit(1) }, 25000)
