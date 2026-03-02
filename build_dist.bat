@echo off
setlocal
title IG-Bot Build Dist Package

echo ===================================
echo [1/5] Cleaning and Preparing Dist
echo ===================================
if exist "dist" rd /s /q "dist"
mkdir "dist"
mkdir "dist\data"
mkdir "dist\config"
mkdir "dist\backups"
mkdir "dist\scripts"
copy "backend\scripts\*.*" "dist\scripts\" >nul

echo.
echo ===================================
echo [2/5] Building Frontend
echo ===================================
call npm run build --workspace=frontend
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================
echo [3/5] Building Backend Executable
echo ===================================
cd backend
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend build failed!
    cd ..
    pause
    exit /b %ERRORLEVEL%
)
cd ..

:: Move the generated executable
if exist "backend\ig-bot-backend.exe" (
    move /Y "backend\ig-bot-backend.exe" "dist\ig-bot.exe" >nul
) else if exist "backend\server.exe" (
    move /Y "backend\server.exe" "dist\ig-bot.exe" >nul
) else (
    echo [ERROR] Executable not found in backend folder!
    pause
    exit /b 1
)

echo.
echo ===================================
echo [4/5] Preparing Deployment Files
echo ===================================
:: Copy package.json for npm install in dist
copy "backend\package.json" "dist\package.json" >nul

:: Create install.bat
echo @echo off > "dist\install.bat"
echo title IG-Bot Driver Installation >> "dist\install.bat"
echo echo Installing production dependencies... >> "dist\install.bat"
echo call npm install --omit=dev >> "dist\install.bat"
echo echo Installing Playwright browsers... >> "dist\install.bat"
echo npx playwright install >> "dist\install.bat"
echo echo. >> "dist\install.bat"
echo echo Installation complete! >> "dist\install.bat"
echo pause >> "dist\install.bat"

:: Create start.bat
echo @echo off > "dist\start.bat"
echo title IG-Bot Server >> "dist\start.bat"
echo ig-bot.exe >> "dist\start.bat"
echo pause >> "dist\start.bat"

echo.
echo ===================================
echo [5/5] Success! Dist folder is ready.
echo ===================================
echo.
echo Next steps for the user:
echo 1. Copy the 'dist' folder to any location.
echo 2. Run 'install.bat' inside 'dist' to set up browsers.
echo 3. Run 'start.bat' to launch the bot.
echo.
pause
