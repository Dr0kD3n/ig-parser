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

:: Backup existing database if it exists to prevent data loss
if exist "dist\config\database.sqlite" (
    echo [INFO] Backing up existing database...
    if not exist "tmp" mkdir "tmp"
    copy /Y "dist\config\database.sqlite" "tmp\database.sqlite.bak" >nul
)

:: Backup data folder if it exists
if exist "dist\data" (
    echo [INFO] Backing up existing data folder...
    if not exist "tmp" mkdir "tmp"
    if exist "tmp\data_bak" rd /s /q "tmp\data_bak"
    mkdir "tmp\data_bak"
    xcopy /E /I /Y "dist\data\*" "tmp\data_bak\" >nul
)

if exist "dist" rd /s /q "dist"
mkdir "dist"
mkdir "dist\data"
mkdir "dist\config"

:: Restore backups
if exist "tmp\database.sqlite.bak" (
    echo [INFO] Restoring database backup...
    copy /Y "tmp\database.sqlite.bak" "dist\config\database.sqlite" >nul
    del "tmp\database.sqlite.bak"
)

if exist "tmp\data_bak" (
    echo [INFO] Restoring data folder backup...
    xcopy /E /I /Y "tmp\data_bak\*" "dist\data\" >nul
    rd /s /q "tmp\data_bak"
)
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
echo [4/6] Copying Support Files
echo ===================================
copy "backend\package.json" "dist\package.json" >nul
copy "backend\scripts\patch-playwright-mcp.js" "dist\scripts\" >nul

echo.
echo ===================================
echo [5/6] Creating Deployment Scripts
echo ===================================

:: Create install.bat
echo @echo off> "dist\install.bat"
echo title IG-Bot Dependency Installation>> "dist\install.bat"
echo cd /d "%%~dp0">> "dist\install.bat"
echo echo.>> "dist\install.bat"
echo echo =============================================>> "dist\install.bat"
echo echo   IG-Bot Standalone Installation>> "dist\install.bat"
echo echo =============================================>> "dist\install.bat"
echo echo.>> "dist\install.bat"
echo echo [1/3] Installing production dependencies...>> "dist\install.bat"
echo set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1>> "dist\install.bat"
echo call npm install --omit=dev>> "dist\install.bat"
echo echo.>> "dist\install.bat"
echo echo [2/3] Patching Playwright for portability...>> "dist\install.bat"
echo node scripts/patch-playwright-mcp.js>> "dist\install.bat"
echo echo.>> "dist\install.bat"
echo echo [3/3] Installing Playwright browsers (Chrome Beta)...>> "dist\install.bat"
echo npx playwright install chrome-beta>> "dist\install.bat"
echo echo.>> "dist\install.bat"
echo echo =============================================>> "dist\install.bat"
echo echo   Installation Complete!>> "dist\install.bat"
echo echo =============================================>> "dist\install.bat"
echo echo Now you can run start.bat to launch the bot.>> "dist\install.bat"
echo pause>> "dist\install.bat"

:: Create start.bat
echo @echo off> "dist\start.bat"
echo title IG-Bot Server>> "dist\start.bat"
echo cd /d "%%~dp0">> "dist\start.bat"
echo ig-bot.exe>> "dist\start.bat"
echo pause>> "dist\start.bat"

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
