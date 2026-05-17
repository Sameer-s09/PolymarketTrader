#!/bin/bash
# VibeTrader — Oracle Cloud deploy script
# Clone the oracle branch then run: bash deploy.sh
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing Node backend dependencies..."
cd "$REPO_DIR/candle-app/backend" && npm install --omit=dev

echo "==> Installing Node frontend dependencies..."
cd "$REPO_DIR/candle-app/frontend" && npm install

echo "==> Building frontend..."
cd "$REPO_DIR/candle-app/frontend" && npm run build

echo "==> Creating data directory..."
mkdir -p "$REPO_DIR/data"

echo "==> Installing Python dependencies..."
cd "$REPO_DIR/btcbacktest" && pip3 install -r requirements.txt --quiet

echo "==> Configuring Nginx..."
sudo cp "$REPO_DIR/nginx.conf" /etc/nginx/sites-available/vibe-trader
sudo ln -sf /etc/nginx/sites-available/vibe-trader /etc/nginx/sites-enabled/vibe-trader
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> Starting PM2 processes..."
cd "$REPO_DIR/candle-app"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | sudo bash

echo ""
echo "==> Done! App running at http://$(curl -s ifconfig.me 2>/dev/null || echo '< your-ip >')"
pm2 status
