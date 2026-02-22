@echo off
title IG-Bot Build
echo Building Frontend...
call npm run build --workspace=frontend
echo Build complete. You can now use start.bat to run the server.
pause
