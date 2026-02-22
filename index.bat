@echo off
chcp 65001 >nul
:: Переходим в папку, где лежит батник
cd /d "%~dp0"

:: --- ШАГ 1: Убиваем старые процессы на 3000 порту ---
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

:: --- ШАГ 2: Переход в src и запуск ---
:: Заходим в папку src, чтобы Node.js видел локальные node_modules
cd src
node index.js

:: --- ШАГ 3: Финальная зачистка ---
:: Возвращаемся в корень, чтобы корректно отработал поиск портов (опционально)
cd ..
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

:: Выход без подтверждения
exit