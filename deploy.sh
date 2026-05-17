#!/bin/bash
# VibeTrader — Oracle Cloud deploy script
# Run once after cloning: bash deploy.sh
set -e

APP_DIR="/opt/vibe-trader"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing Node dependencies..."
cd "$REPO_DIR/candle-app/backend" && npm install --omit=dev
cd "$REPO_DIR/candle-app/frontend" && npm install

echo "==> Building frontend..."
cd "$REPO_DIR/candle-app/frontend" && npm run build

echo "==> Copying built assets to app dir..."
mkdir -p "$APP_DIR/data"
rsync -a --delete "$REPO_DIR/candle-app/backend/"  "$APP_DIR/backend/"
rsync -a --delete "$REPO_DIR/candle-app/frontend/dist/" "$APP_DIR/frontend/dist/"
rsync -a --delete "$REPO_DIR/btcbacktest/"  "$APP_DIR/btcbacktest/"
cp "$REPO_DIR/candle-app/ecosystem.config.js" "$APP_DIR/"

echo "==> Installing Python dependencies..."
cd "$APP_DIR/btcbacktest" && pip3 install -r requirements.txt --quiet

echo "==> Configuring Nginx..."
sudo cp "$REPO_DIR/nginx.conf" /etc/nginx/sites-available/vibe-trader
sudo ln -sf /etc/nginx/sites-available/vibe-trader /etc/nginx/sites-enabled/vibe-trader
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> Starting PM2 processes..."
cd "$APP_DIR"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | sudo bash

echo ""
echo "==> Done! App running at http://$(curl -s ifconfig.me)"
pm2 status
