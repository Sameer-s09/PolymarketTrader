const WebSocket = require('ws')
const ws = new WebSocket('ws://localhost:3002')
let msgs = 0
ws.on('message', raw => {
  const msg = JSON.parse(raw)
  if (msg.type === 'candle') {
    msgs++
    console.log(`tick ${msgs}: close=${msg.data.close} time=${msg.data.time} isComplete=${msg.data.isComplete}`)
    if (msgs >= 3) { ws.close(); process.exit(0) }
  }
  if (msg.type === 'connected') console.log('WS connected to broadcaster')
})
ws.on('error', e => { console.log('err:', e.message); process.exit(1) })
setTimeout(() => { console.log(`timeout — got ${msgs} candle ticks`); process.exit(1) }, 15000)
