#!/bin/bash

# Переходим в директорию, где лежит сам скрипт
cd "$(dirname "$0")"

# --- ШАГ 1: Убиваем процессы на 3000 порту (если есть) ---
# lsof -t возвращает только PID процесса
PORT_PID=$(lsof -t -i:3000)
if [ ! -z "$PORT_PID" ]; then
    echo "Очистка порта 3000 (PID: $PORT_PID)..."
    kill -9 $PORT_PID
fi

# --- ШАГ 2: Переход в src и запуск ---
# Проверяем наличие папки src
if [ -d "src" ]; then
    cd src
    # Запускаем node
    if [ -f "server.js" ]; then
        node server.js
    elif [ -f "index.js" ]; then
        node index.js
    else
        echo "Ошибка: Файл запуска (server.js или index.js) не найден в папке src."
    fi
else
    echo "Ошибка: Папка src не найдена."
fi

# --- ШАГ 3: Финальная зачистка (опционально) ---
cd ..
PORT_PID_FINAL=$(lsof -t -i:3000)
if [ ! -z "$PORT_PID_FINAL" ]; then
    kill -9 $PORT_PID_FINAL
fi

exit 0