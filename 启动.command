#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")" || exit 1
command -v npm >/dev/null || { echo "请先安装 Node.js 22 LTS"; exit 1; }
if [ ! -d node_modules ]; then
  npm ci || exit 1
fi
npm run dev -- --open
