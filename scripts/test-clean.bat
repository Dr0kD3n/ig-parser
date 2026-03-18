@echo off
setlocal
title IG-Bot Clean Folder Test

set "TEST_DIR=C:\IG-Bot-Clean-Test"

echo [1/3] Preparing clean directory at %TEST_DIR%...
if exist "%TEST_DIR%" (
    echo [INFO] Removing old test directory...
    rd /s /q "%TEST_DIR%"
)
mkdir "%TEST_DIR%"

echo [2/3] Copying dist files...
xcopy /E /I /Y "dist\*" "%TEST_DIR%\" >nul

echo [3/3] Running installation in clean folder...
cd /d "%TEST_DIR%"
call install.bat

echo.
echo ======================================================
echo Test environment ready!
echo Path: %TEST_DIR%
echo Action: Now run start.bat in that folder to launch.
echo ======================================================
pause
