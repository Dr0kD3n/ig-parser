@echo off
chcp 65001 >nul
title IG-Bot Final Launcher

:: Фиксируем путь к папке батника
set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

echo ==========================================================
echo   ЗАПУСК БОТА (Локальные модули в SRC)
echo ==========================================================

:: 1. Проверяем наличие папки src
if not exist "src" (
    echo [ОШИБКА] Папка "src" не найдена!
    pause
    exit /b
)

:: 2. ПЕРЕХОДИМ В SRC (чтобы модули искались именно тут)
cd src

:: 3. Установка зависимостей (ПРЯМО В ПАПКУ SRC)
:: Если package.json не в src, NPM выдаст ошибку, поэтому проверяем его
if not exist "package.json" (
    echo [ВНИМАНИЕ] Файл package.json должен лежать внутри папки src!
    echo Перенесите его из корня в папку src и перезапустите батник.
    pause
    exit /b
)

if not exist "node_modules" (
    echo [1/2] Установка модулей в папку src...
    call npm install
) else (
    echo [1/2] Модули уже установлены!
)

:: 4. Установка браузеров
echo [2/2] Проверка Playwright...
call npx playwright install chromium

:: 5. ЗАПУСК
echo ----------------------------------------------------------
echo [!] Готово!

if %errorlevel% neq 0 (
    echo.
    echo [!] Произошла ошибка. Проверьте логи выше.
)

pause