@echo off
title IG-Bot Dev

echo Killing all Node.js and related server processes...

taskkill /F /IM node.exe /T


echo Starting Development Environment...
npm run dev:all
echo.
echo [!] Press any key to exit.
pause
