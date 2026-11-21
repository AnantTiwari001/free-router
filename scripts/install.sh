#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:-https://github.com/AnantTiwari001/free-router/archive/refs/heads/main.tar.gz}"
PREFIX="${FR_PREFIX:-}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v22.18 or newer): https://nodejs.org/" >&2
  exit 1
fi

NODE_OK="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a > 22 || (a === 22 && b >= 18)')"
if [ "$NODE_OK" != "true" ]; then
  echo "Node.js v22.18 or newer is required; found $(node --version)." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

if [[ "$SOURCE" != http://* && "$SOURCE" != https://* ]] && [ ! -e "$SOURCE" ]; then
  echo "Install source not found: $SOURCE" >&2
  echo "Usage: scripts/install.sh [path-to-repo-or-tarball]" >&2
  exit 1
fi

if [ -n "$PREFIX" ]; then
  npm install -g --prefix "$PREFIX" "$SOURCE"
  FR_BIN="$PREFIX/bin/fr"
else
  npm install -g "$SOURCE"
  FR_BIN="$(npm prefix -g)/bin/fr"
fi

if [ ! -x "$FR_BIN" ]; then
  FR_BIN="$(command -v fr || true)"
fi

if [ -z "$FR_BIN" ] || [ ! -x "$FR_BIN" ]; then
  echo "Installed, but could not find the fr binary. Add npm's global bin directory to PATH." >&2
  exit 1
fi

echo "Installed: $FR_BIN"
if [ "${FR_NO_SETUP:-0}" != "1" ]; then
  "$FR_BIN" setup --install-missing --auth
fi

echo
echo "If 'fr' is not found in a new shell, add this to PATH:"
echo "  $(dirname "$FR_BIN")"
