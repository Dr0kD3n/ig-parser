#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "=============================================="
echo "   IG-Bot Unix Installation Script"
echo "=============================================="

# 1. Check for Node.js
if ! command -v node &> /dev/null
then
    echo "ERROR: Node.js is not installed. Please install it first."
    exit 1
fi

# 2. Install dependencies
echo "[1/3] Installing dependencies..."
npm install --omit=dev --legacy-peer-deps

# 3. Patch Playwright
echo "[2/3] Patching Playwright..."
node scripts/patch-playwright-mcp.js

# 4. Install Playwright browsers and deps
echo "[3/3] Cleaning old browsers and installing current Playwright version..."
PW_VER=$(node -e "console.log(require('./package.json').dependencies.playwright || require('./package.json').devDependencies.playwright)")
if [ "$PW_VER" = "undefined" ]; then PW_VER="latest"; fi

echo "Cleaning old versions..."
npx playwright@$PW_VER uninstall --all
echo "Installing current browsers..."
if [ "$(uname -s)" = "Darwin" ]; then
    npx playwright@$PW_VER install chromium
else
    npx playwright@$PW_VER install chromium --with-deps
fi

echo ""
echo "=============================================="
echo "   Installation Complete!"
if [ "$(uname -s)" = "Darwin" ]; then
    echo "   Run './start-macos.sh' to begin."
else
    echo "   Installation finished."
fi
echo "=============================================="
