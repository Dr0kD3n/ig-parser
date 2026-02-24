@echo off
echo Cleaning up project processes...
taskkill /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq IG-Bot*"
taskkill /F /IM node.exe /T 2>nul
echo Done.
pause
