'use strict';
const path = require('path');
const fs = require('fs').promises;
const { getDB } = require('./db');
const logger = require('./logger');

let checkerStatus = {
    running: false,
    current: 0,
    total: 0,
    status: 'Idle',
};

let schedulerStopRequested = false; // Переменная флага остановки (checkerStopRequested)

/**
 * Декодирует кривую кодировку Instagram (ISO-8859-1 в UTF-8)
 */
function fixEncoding(str) {
    if (!str) return '';
    try {
        return Buffer.from(str, 'latin1').toString('utf8');
    } catch (e) {
        return str;
    }
}

async function checkFeedback() {
    if (checkerStatus.running) return;

    checkerStatus.running = true;
    checkerStatus.status = 'Scanning folders...';
    checkerStatus.current = 0;
    checkerStatus.total = 0;
    schedulerStopRequested = false;
    console.log(process.cwd())
    const db = await getDB();
    const inboxPath = path.join(process.cwd(), '/data/inbox');
    logger.info(`📂 Запуск сканирования папки: ${inboxPath}`);

    try {
        // Читаем все папки внутри директории inbox
        const chatFolders = await fs.readdir(inboxPath).catch(() => []);

        if (chatFolders.length === 0) {
            logger.warn(`⚠️ Папка inbox пуста или не найдена по пути: ${inboxPath}`);
            checkerStatus = { running: false, status: 'Inbox folder empty', current: 0, total: 0 };
            return;
        }

        checkerStatus.total = chatFolders.length;

        for (const folder of chatFolders) {
            if (schedulerStopRequested) {
                logger.warn('🛑 Проверка прервана по запросу (stopChecker).');
                break;
            }

            checkerStatus.status = `Analyzing folder: ${folder}`;
            const messageFilePath = path.join(inboxPath, folder, 'message_1.json');

            // Проверяем наличие файла message_1.json
            const fileData = await fs.readFile(messageFilePath, 'utf-8').catch(() => null);
            if (!fileData) continue;

            try {
                const chatData = JSON.parse(fileData);
                const messages = chatData.messages || [];

                // Если в чате меньше 2 сообщений, то ответа физически быть не может
                if (messages.length < 2) continue;

                const participants = chatData.participants || [];
                // В структуре инсты: participants[1] — это вы (отправитель), participants[0] — собеседник
                const myAccountName = participants[1] ? participants[1].name : null;

                // Самое последнее сообщение в чате (верхнее в массиве)
                const latestMessage = messages[0];
                const latestSender = latestMessage.sender_name;

                // Условие: Если последнее сообщение написано НЕ владельцем аккаунта -> значит нам ответили
                if (myAccountName && latestSender !== myAccountName) {

                    // Достаем чистый юзернейм из названия папки (все что до первого подчёркивания)
                    const usernameFromFolder = folder.split('_')[0].toLowerCase().trim();

                    // Текст ответа собеседника
                    const interlocutorReply = fixEncoding(latestMessage.content || '[Медиа/Лайк/Реакция]');

                    // Ищем НАШЕ сообщение, на которое пришел этот ответ
                    let ourSentMessage = '[Не найдено или было удалено]';
                    for (let i = 1; i < messages.length; i++) {
                        if (messages[i].sender_name === myAccountName) {
                            ourSentMessage = fixEncoding(messages[i].content || '[Медиа-вложение]');
                            break;
                        }
                    }

                    // Обновляем m.status напрямую в таблице messages_log.
                    // Проверяем совпадение по полю url (ищем вхождение юзернейма в ссылку)
                    // Меняем только для тех записей, которые еще не помечены как replied или liked
                    const logUpdate = await db.run(
                        `UPDATE messages_log 
                         SET status = 'replied' 
                         WHERE LOWER(url) LIKE ? AND status NOT IN ('replied', 'liked')`,
                        [`%${usernameFromFolder}%`]
                    );

                    if (logUpdate.changes > 0) {
                        checkerStatus.current++;

                        console.log(`\n[ЛОГ ОБНОВЛЕН #${checkerStatus.current}] --------------------------------`);
                        console.log(`👤 Юзернейм из папки: @${usernameFromFolder}`);
                        console.log(`✉️  Наш текст:        "${ourSentMessage}"`);
                        console.log(`💬 Их ответ:        "${interlocutorReply}"`);
                        console.log(`📝 Обновлено строк в messages_log: ${logUpdate.changes}`);
                    } else {
                        // Сообщение найдено в файлах, но в таблице логов такой юзернейм в статусе ожидания отсутствует
                        console.log(`\n[ℹ️  Без изменений] В папке @${usernameFromFolder} есть ответ, но в messages_log нет подходящих строк для обновления.`);
                    }
                }

            } catch (err) {
                logger.error(`❌ Ошибка парсинга JSON в папке ${folder}: ${err.message}`);
            }
        }

        console.log('\n--------------------------------------------------');
        logger.info(`🏁 Обработка завершена. Всего обновлено ответов в messages_log: ${checkerStatus.current}`);

    } catch (err) {
        logger.error(`🚨 Критическая ошибка при работе с базой или папкой: ${err.message}`);
    }

    checkerStatus.status = 'Finished';
    checkerStatus.running = false;
}

function getCheckerStatus() {
    return checkerStatus;
}

function stopChecker() {
    schedulerStopRequested = true;
}

module.exports = {
    checkFeedback,
    getCheckerStatus,
    stopChecker
};