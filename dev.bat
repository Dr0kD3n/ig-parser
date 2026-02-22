@echo off
echo Starting Vite dev server (frontend)...
cd /d "%~dp0frontend"
start cmd /k npm run dev
cd /d "%~dp0backend"
echo Starting Node.js backend...
node server.js
