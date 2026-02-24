@echo off
echo Killing all Node.js and related server processes...

taskkill /F /IM node.exe /T

echo Done.
pause
