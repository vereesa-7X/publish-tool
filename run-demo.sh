#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_NODE="$ROOT_DIR/.tools/node/bin/node"
LOCAL_NPM_CLI="$ROOT_DIR/.tools/node/lib/node_modules/npm/bin/npm-cli.js"
NODE_BIN_DIR=""

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NPM_CMD=(npm)
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
elif [[ -x "$LOCAL_NODE" && -f "$LOCAL_NPM_CLI" ]]; then
  NPM_CMD=("$LOCAL_NODE" "$LOCAL_NPM_CLI")
  NODE_BIN_DIR="$(dirname "$LOCAL_NODE")"
else
  echo "Missing Node.js runtime. Install Node.js or place a local runtime under .tools/node/."
  exit 1
fi

export PATH="$NODE_BIN_DIR:$PATH"

cd "$ROOT_DIR"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  "${NPM_CMD[@]}" install
fi

if [[ ! -f "$ROOT_DIR/.env.local" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env.local"
fi

"${NPM_CMD[@]}" run dev
