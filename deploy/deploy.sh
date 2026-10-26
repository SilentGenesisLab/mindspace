#!/usr/bin/env bash
# 在服务器上执行：bash deploy/deploy.sh
set -euo pipefail

APP_DIR=/home/donxu/apps/mindspace
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo ".env 不存在，先放好环境变量" >&2
  exit 1
fi

export PATH=/home/donxu/.local/node24/bin:/usr/local/bin:/usr/bin:/bin
export NODE_OPTIONS=--max-old-space-size=3072

echo "== install =="
npm ci --no-audit --no-fund

echo "== build =="
npm run build

echo "== migrate =="
set -a
# shellcheck disable=SC1091
. ./.env
set +a
npm run migrate

echo "== restart =="
sudo -n systemctl restart mindspace 2>/dev/null || systemctl --user restart mindspace 2>/dev/null || echo "需要手动执行 sudo systemctl restart mindspace"
sleep 3
curl -fsS http://127.0.0.1:3020/api/health && echo
