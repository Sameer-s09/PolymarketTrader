module.exports = {
  apps: [
    {
      name: 'vibe-trader',
      script: 'npx',
      args: 'tsx src/server.ts',
      cwd: '/opt/vibe-trader/backend',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        JOURNAL_PATH: '/opt/vibe-trader/data/fade_journal.jsonl',
      },
      watch: false,
      max_memory_restart: '400M',
      restart_delay: 3000,
      autorestart: true,
    },
    {
      name: 'vibe-flask',
      script: 'python3',
      args: 'live_app.py',
      cwd: '/opt/vibe-trader/btcbacktest',
      watch: false,
      max_memory_restart: '200M',
      restart_delay: 3000,
      autorestart: true,
    },
  ],
}
