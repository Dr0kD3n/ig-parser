@echo off
setlocal enabledelayedexpansion
title IG-Bot Full System Install

echo ======================================================
echo IG-Bot Installation & Environment Setup
echo ======================================================
echo.

:: 1. Check for Node.js
echo [1/4] Checking for Node.js...
node -v >nul 2>&1
if !errorlevel! neq 0 (
    echo Node.js is NOT installed.
    echo Attempting to install Node.js via winget...
    winget install -e --id OpenJS.NodeJS
    if !errorlevel! neq 0 (
        echo.
        echo ERROR: Failed to install Node.js automatically.
        echo Please install Node.js manually from https://nodejs.org/
        pause
        exit /b 1
    )
    echo Node.js installed successfully. Please RESTART this script to continue.
    pause
    exit /b 0
) else (
    echo Node.js is already installed.
)

:: 2. Install Project Dependencies
echo.
echo [2/4] Installing project and workspace dependencies...
call npm install
if !errorlevel! neq 0 (
    echo.
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

:: 3. Install Playwright Browsers and System Dependencies
echo.
echo [3/4] Installing Playwright browsers and system dependencies...
call npx playwright install --with-deps
if !errorlevel! neq 0 (
    echo.
    echo ERROR: Playwright installation failed.
    pause
    exit /b 1
)

:: 4. Verify SQLite3 (Pre-built binaries should work, but checking)
echo.
echo [4/4] Finalizing setup...
echo Done.

echo.
echo ======================================================
echo Installation Complete!
echo You can now run the project using dev.bat or start.bat
echo ======================================================
echo.
pause
