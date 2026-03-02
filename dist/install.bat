@echo off 
title IG-Bot Driver Installation 
echo Installing production dependencies... 
call npm install --omit=dev 
echo Installing Playwright browsers... 
npx playwright install 
echo. 
echo Installation complete! 
pause 
