@echo off
setlocal
title IG-Bot Portable Build Creator

echo ===================================
echo [0/6] Running Tests
echo ===================================
call npm test
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Tests failed! Build aborted.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================
echo [1/6] Cleaning and Preparing Dist
echo ===================================

if exist "dist" rd /s /q "dist"
mkdir "dist"
mkdir "dist\data"
mkdir "dist\config"
mkdir "dist\scripts"

echo.
echo ===================================
echo [2/6] Building Frontend
echo ===================================
cd frontend
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend build failed!
    cd ..
    pause
    exit /b %ERRORLEVEL%
)
cd ..
mkdir "dist\public"
xcopy /E /I /Y "backend\public\*" "dist\public\" >nul

echo.
echo ===================================
echo [3/6] Building Backend Executable
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

:: Copy the generated executable. Keep backend output available for diagnostics/rebuilds.
set "BACKEND_EXE="
if exist "backend\ig-bot-local-backend.exe" set "BACKEND_EXE=backend\ig-bot-local-backend.exe"
if not defined BACKEND_EXE if exist "backend\ig-bot-backend.exe" set "BACKEND_EXE=backend\ig-bot-backend.exe"
if not defined BACKEND_EXE if exist "backend\server.exe" set "BACKEND_EXE=backend\server.exe"
if not defined BACKEND_EXE (
    echo [ERROR] Executable not found in backend folder!
    pause
    exit /b 1
)
copy /Y "%BACKEND_EXE%" "dist\ig-bot.exe" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy executable to dist!
    pause
    exit /b 1
)
if not exist "dist\ig-bot.exe" (
    echo [ERROR] dist\ig-bot.exe was not created!
    pause
    exit /b 1
)

if not exist "backend\ig-bot-local-backend-macos-x64" (
    echo [ERROR] Intel macOS executable not found in backend folder!
    pause
    exit /b 1
)
if not exist "backend\ig-bot-local-backend-macos-arm64" (
    echo [ERROR] Apple Silicon macOS executable not found in backend folder!
    pause
    exit /b 1
)
copy /Y "backend\ig-bot-local-backend-macos-x64" "dist\ig-bot-macos-x64" >nul
copy /Y "backend\ig-bot-local-backend-macos-arm64" "dist\ig-bot-macos-arm64" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy macOS executables to dist!
    pause
    exit /b 1
)

echo.
echo ===================================
echo [4/6] Copying Support Files
echo ===================================
copy "backend\package.json" "dist\package.json" >nul
copy "backend\scripts\patch-playwright-mcp.js" "dist\scripts\" >nul
copy "install.sh" "dist\" >nul
copy "start-macos.sh" "dist\" >nul
echo.
echo ===================================
echo [5/6] Creating Deployment Scripts
echo ===================================

:: Create install.bat
> "dist\install.bat" echo @echo off
>> "dist\install.bat" echo setlocal enabledelayedexpansion
>> "dist\install.bat" echo title IG-Bot Dependency Installation
>> "dist\install.bat" echo cd /d "%%~dp0"
>> "dist\install.bat" echo echo.
>> "dist\install.bat" echo echo =============================================
>> "dist\install.bat" echo echo   IG-Bot Standalone Installation
>> "dist\install.bat" echo echo =============================================
>> "dist\install.bat" echo echo.
>> "dist\install.bat" echo :: 1. Check for Node.js
>> "dist\install.bat" echo echo [1/4] Checking for Node.js...
>> "dist\install.bat" echo node -v ^>nul 2^>^&1
>> "dist\install.bat" echo if %%errorlevel%% neq 0 (
>> "dist\install.bat" echo     echo.
>> "dist\install.bat" echo     echo ERROR: Node.js is NOT installed or not in PATH.
>> "dist\install.bat" echo     echo Please install Node.js from https://nodejs.org/
>> "dist\install.bat" echo     pause
>> "dist\install.bat" echo     exit /b 1
>> "dist\install.bat" echo )
>> "dist\install.bat" echo node -v
>> "dist\install.bat" echo :: 2. Install Project Dependencies
>> "dist\install.bat" echo echo [2/4] Installing production dependencies...
>> "dist\install.bat" echo set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
>> "dist\install.bat" echo call npm install --omit=dev --legacy-peer-deps
>> "dist\install.bat" echo if %%errorlevel%% neq 0 (
>> "dist\install.bat" echo     echo.
>> "dist\install.bat" echo     echo ERROR: npm install failed.
>> "dist\install.bat" echo     pause
>> "dist\install.bat" echo     exit /b 1
>> "dist\install.bat" echo )
>> "dist\install.bat" echo echo.
>> "dist\install.bat" echo :: 3. Patching Playwright
>> "dist\install.bat" echo echo [3/4] Patching Playwright for portability...
>> "dist\install.bat" echo node scripts/patch-playwright-mcp.js
>> "dist\install.bat" echo echo.
>> "dist\install.bat" echo :: 4. Install Playwright Browsers
>> "dist\install.bat" echo echo [4/4] Cleaning old browsers and installing current version...
>> "dist\install.bat" echo for /f "tokens=*" %%%%v in ('node -e "console.log(require('./package.json').dependencies.playwright || require('./package.json').devDependencies.playwright)"') do set PW_VER=%%%%v
>> "dist\install.bat" echo if "%%PW_VER%%"=="undefined" set PW_VER=latest
>> "dist\install.bat" echo echo Cleaning old Playwright versions...
>> "dist\install.bat" echo call npx playwright@%%PW_VER%% uninstall --all
>> "dist\install.bat" echo echo Installing current Playwright browsers...
>> "dist\install.bat" echo call npx playwright@%%PW_VER%% install chromium --with-deps

>> "dist\install.bat" echo if %%errorlevel%% neq 0 (
>> "dist\install.bat" echo     echo.
>> "dist\install.bat" echo     echo ERROR: Playwright browser installation failed.
>> "dist\install.bat" echo     pause
>> "dist\install.bat" echo     exit /b 1
>> "dist\install.bat" echo )
>> "dist\install.bat" echo echo.
>> "dist\install.bat" echo echo =============================================
>> "dist\install.bat" echo echo   Installation Complete!
>> "dist\install.bat" echo echo =============================================
>> "dist\install.bat" echo echo Now you can run start.bat to launch the bot.
>> "dist\install.bat" echo pause

:: Create start.bat
> "dist\start.bat" echo @echo off
>> "dist\start.bat" echo title IG-Bot Server
>> "dist\start.bat" echo cd /d "%%~dp0"
>> "dist\start.bat" echo ig-bot.exe
>> "dist\start.bat" echo pause

echo.
echo ===================================
echo [6/6] Success! Dist folder is ready.
echo ===================================
echo.
echo Next steps:
echo 1. The 'dist' folder is now a COMPLETE standalone package.
echo 2. Move it anywhere (USB, Desktop, Server).
echo 3. Run 'install.bat' ONCE in the new location.
echo 4. Run 'start.bat' to launch.
echo.
pause
