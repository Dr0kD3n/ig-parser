@echo off
title IG-Bot Dependency Installation
cd /d "%~dp0"
echo.
echo =============================================
echo   IG-Bot Standalone Installation
echo =============================================
echo.
echo [1/3] Installing production dependencies...
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=
call npm install --omit=dev
echo.
echo [2/3] Patching Playwright for portability...
node scripts/patch-playwright-mcp.js
echo.
echo [3/3] Installing Playwright browsers (Chrome Beta)...
npx playwright install chrome-beta
echo.
echo =============================================
echo   Installation Complete!
echo =============================================
echo Now you can run start.bat to launch the bot.
pause
