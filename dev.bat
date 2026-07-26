@echo off
title IG-Bot Dev

echo Stopping previous IG-Bot development services...
for %%P in (5000 5001 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    taskkill /F /PID %%A /T >nul 2>&1
  )
)
timeout /t 1 /nobreak >nul

echo Starting Development Environment...
node scripts\dev-launcher.js
echo.
echo [!] Press any key to exit.
pause
