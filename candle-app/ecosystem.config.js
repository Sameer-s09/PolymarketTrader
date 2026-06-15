module.exports = {
  apps: [
    {
      name: 'vibe-trader',
      script: 'npx',
      args: 'tsx src/server.ts',
      cwd: '/opt/vibe-trader/candle-app/backend',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        JOURNAL_PATH: '/opt/vibe-trader/btcbacktest/data/fade_journal.jsonl',
        MOCK_TRADES_PATH: '/opt/vibe-trader/btcbacktest/data/mock_trades.jsonl',
      },
      watch: false,
      max_memory_restart: '400M',
      restart_delay: 3000,
      autorestart: true,
    },
    {
      name: 'vibe-flask',
      script: 'python3',
      args: '-m gunicorn --workers 1 --bind 0.0.0.0:5050 --timeout 120 --access-logfile - live_app:app',
      cwd: '/opt/vibe-trader/btcbacktest',
      watch: false,
      max_memory_restart: '200M',
      restart_delay: 3000,
      autorestart: true,
    },
  ],
}
