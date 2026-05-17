const WebSocket = require('ws')

console.log('[test] Connecting to Bitstamp WS...')
const ws = new WebSocket('wss://ws.bitstamp.net')

ws.on('open', () => {
  console.log('[test] Connected! Subscribing...')
  ws.send(JSON.stringify({
    event: 'bts:subscribe',
    data: { channel: 'live_trades_btcusd' }
  }))
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  console.log('[test] msg event:', msg.event, '| data type:', typeof msg.data)
  if (msg.event === 'trade') {
    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
    console.log('[test] TRADE price:', data.price, 'ts:', data.timestamp)
    ws.close()
    process.exit(0)
  }
})

ws.on('error', (err) => console.error('[test] ERROR:', err.message))
ws.on('close', () => console.log('[test] closed'))

setTimeout(() => {
  console.log('[test] Timeout — no trade received in 15s')
  process.exit(1)
}, 15000)
