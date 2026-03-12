@echo off
title IG-Bot Build
echo Running Tests...
call npm test
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Tests failed! Build aborted.
    pause
    exit /b %ERRORLEVEL%
)

echo Building Frontend...
call npm run build --workspace=frontend
echo Build complete. You can now use start.bat to run the server.
pause
