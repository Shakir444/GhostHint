#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 20 or newer is required." >&2; exit 1; fi
if [ ! -f server/.env ]; then cp server/.env.example server/.env; fi
if [ ! -d node_modules ]; then npm install; fi
npm run dev
