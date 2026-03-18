# Инструкция по тестированию билда в изоляции

### 1. Windows Sandbox (Рекомендуемый)
Самый надежный способ проверить «чистую» установку на Windows.
- **Файл**: [test-isolated.wsb](file:///c:/Users/root/Documents/Projects/ig/ig-bot/test-isolated.wsb)
- **Как запустить**: 
    1. Убедитесь, что в «Компонентах Windows» включен «Песочница Windows» (Windows Sandbox).
    2. Дважды кликните по `test-isolated.wsb`.
    3. В открывшемся окне на рабочем столе будет папка `ig-bot`.
    4. Запустите `install.bat`, затем `start.bat`.

### 2. Симуляция чистой папки
Простой способ проверить переносимость файлов без виртуализации.
- **Файл**: [test-clean.bat](file:///c:/Users/root/Documents/Projects/ig/ig-bot/scripts/test-clean.bat)
- **Как запустить**:
    1. Запустите `scripts/test-clean.bat` от имени администратора.
    2. Он создаст папку `C:\IG-Bot-Clean-Test` и скопирует туда билд.
    3. Затем он запустит `install.bat` в новой папке.

### 3. Docker (Linux/Playwright)
Если нужно проверить работу в контейнере.
- **Файл**: [Dockerfile.test](file:///c:/Users/root/Documents/Projects/ig/ig-bot/Dockerfile.test)
- **Команды**:
    ```bash
    docker build -t ig-bot-test -f Dockerfile.test .
    docker run -p 5000:5000 ig-bot-test
    ```

> [!TIP]
> **Windows Sandbox** — лучший выбор, так как он не содержит установленного Node.js/Git и других инструментов разработчика, что позволяет проверить работу `install.bat` в реальных условиях пользователя.
