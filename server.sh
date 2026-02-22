#!/bin/bash

# --- ФУНКЦИЯ УБИЙСТВА ПОРТА ---
kill_port_3000() {
    echo "[CLEANUP] Проверка порта 3000..."
    # Ищем PID процесса, слушающего порт 3000
    PID=$(lsof -t -i:3000)
    
    if [ ! -z "$PID" ]; then
        echo "[CLEANUP] Убиваем зависший процесс PID: $PID"
        kill -9 $PID > /dev/null 2>&1
    fi
}

# --- ПОДГОТОВКА ПУТИ ---
# Переходим в директорию скрипта, а затем в src
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/src" || {
    echo "[ERROR] Папка src не найдена рядом со скриптом!"
    exit 1
}

echo "[SCRIPT] Рабочая папка: $(pwd)"

# --- ПРОВЕРКА 1: Есть ли Node.js? ---
node -v > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo ""
    echo "[ERROR] Node.js не найден! Установите Node.js или добавьте его в PATH."
    echo ""
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

# --- ПРОВЕРКА 2: Есть ли server.js в папке src? ---
if [ ! -f "server.js" ]; then
    echo ""
    echo "[ERROR] Файл server.js не найден в папке src!"
    echo "Текущий путь: $(pwd)"
    echo ""
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

# --- ШАГ 1: Очистка порта перед запуском ---
kill_port_3000

# --- ШАГ 2: Запуск сервера ---
echo ""
echo "[SCRIPT] Запускаем node server.js из папки src..."
echo "------------------------------------------"
# Запуск
node server.js
echo ""
echo "------------------------------------------"

# Если сервер упал сам или был закрыт
echo "[SCRIPT] Процесс Node.js завершен."

# --- ШАГ 3: Финальная очистка порта ---
kill_port_3000

echo ""
echo "[SCRIPT] Готово. Нажмите Enter для выхода."
read -p ""
exit 0