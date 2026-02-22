@echo off
title IG-Bot Dev
echo Starting Development Environment...
start /b cmd /c "npm run dev --workspace=frontend"
start /b cmd /c "node backend\server.js"
echo.
echo Servers are running on port 1337 (Backend) and 5173 (Frontend).
echo [!] To stop the servers, close this console window.
pause
