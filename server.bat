@echo off
:: Устанавливаем кодировку
chcp 65001 >nul
setlocal

:: --- ВАЖНО: Переходим в папку src, где лежит код и модули ---
cd /d "%~dp0src"

echo [SCRIPT] Рабочая папка: %CD%

:: --- ПРОВЕРКА 1: Есть ли Node.js? ---
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Node.js не найден! Установите Node.js или добавьте его в PATH.
    echo.
    pause
    exit /b
)

:: --- ПРОВЕРКА 2: Есть ли server.js в папке src? ---
if not exist "server.js" (
    echo.
    echo [ERROR] Файл server.js не найден в папке src!
    echo Текущий путь: %CD%
    echo.
    pause
    exit /b
)

:: --- ШАГ 1: Очистка порта перед запуском ---
call :KillPort3000

:: --- ШАГ 2: Запуск сервера ---
echo.
echo [SCRIPT] Запускаем node server.js из папки src...
echo ------------------------------------------
:: Node.js автоматически подхватит node_modules, так как мы уже в папке src
node server.js
echo.
echo ------------------------------------------

:: Если сервер упал сам или был закрыт
echo [SCRIPT] Процесс Node.js завершен.

:: --- ШАГ 3: Финальная очистка порта ---
call :KillPort3000

echo.
echo [SCRIPT] Готово. Нажмите любую клавишу для выхода.
pause
exit /b

:: --- ФУНКЦИЯ УБИЙСТВА ПОРТА ---
:KillPort3000
echo [CLEANUP] Проверка порта 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    echo [CLEANUP] Убиваем зависший процесс PID: %%a
    taskkill /f /pid %%a >nul 2>&1
)
exit /b