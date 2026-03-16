@echo off
setlocal enabledelayedexpansion
title IG-Bot Dependency Installation
cd /d "%~dp0"
echo.
echo =============================================
echo   IG-Bot Standalone Installation
echo =============================================
echo.
:: 1. Check for Node.js
echo [1/4] Checking for Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js is NOT installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
node -v
echo.
:: 2. Install Project Dependencies
echo [2/4] Installing production dependencies...
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
call npm install --omit=dev
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed.
    pause
    exit /b 1
)
echo.
:: 3. Patching Playwright
echo [3/4] Patching Playwright for portability...
node scripts/patch-playwright-mcp.js
echo.
:: 4. Install Playwright Browsers
echo [4/4] Installing Playwright browsers (Chrome Beta)...
call npx playwright install chrome-beta --with-deps
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Playwright browser installation failed.
    pause
    exit /b 1
)
echo.
echo =============================================
echo   Installation Complete!
echo =============================================
echo Now you can run start.bat to launch the bot.
pause
