@echo off
echo Building frontend for production...
cd /d "%~dp0frontend"
npm run build
echo:
echo Build complete! Output: backend/public/
echo Now restart the server: node backend/server.js
