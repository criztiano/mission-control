#!/bin/bash
# Eden deploy script — triggered after merging to main
# Pulls latest main, rebuilds, restarts the server
set -e

EDEN_DIR="$HOME/Projects/mission-control"
LOG_FILE="/tmp/eden.log"

cd "$EDEN_DIR"

echo "🔄 Pulling latest main..."
git checkout main
git pull origin main

echo "🧹 Cleaning old build..."
rm -rf .next

echo "🔨 Building..."
npx next build

echo "🔁 Restarting Eden..."
kill -9 $(/usr/sbin/lsof -ti :3333) 2>/dev/null || true
sleep 2
NODE_ENV=production nohup node server.mjs > "$LOG_FILE" 2>&1 &

echo "✅ Eden deployed successfully (PID: $!)"
echo "   Logs: $LOG_FILE"
