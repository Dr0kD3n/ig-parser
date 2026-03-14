"use strict";
const { getDB } = require("./db");
const { createBrowserContext, optimizeContextForScraping, takeLiveScreenshot, checkLoginPage } = require("./browser");
const { wait } = require("./utils");
const { saveCrashReport } = require("./reporter");
const { getSetting, getAllAccounts } = require("./config");

let stopRequested = false;

function stopRestorePhotos() {
    stopRequested = true;
    console.log('🛑 ЗАПРОШЕНА ОСТАНОВКА ВОССТАНОВЛЕНИЯ ФОТО');
}

/**
 * Ожидание с возможностью прерывания
 */
async function activeWait(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (stopRequested) return true;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
}

async function restorePhotos(onProgress, overrideConcurrency) {
    stopRequested = false;
    console.log('🚀 ЗАПУСК МНОГОПОТОЧНОГО ВОССТАНОВЛЕНИЯ ФОТО...');
    const db = await getDB();

    // 1. Получаем активные профили (vote != 'dislike')
    const profiles = await db.all(`SELECT url, username, name FROM profiles WHERE vote != 'dislike' ORDER BY timestamp DESC`);
    if (profiles.length === 0) {
        console.log('⚠️ Нет активных профилей для восстановления фото.');
        return { success: true, count: 0 };
    }

    console.log(`🎯 Найдено профилей для проверки: ${profiles.length}`);

    // Get concurrency setting
    let concurrency = 3;
    if (overrideConcurrency) {
        concurrency = Math.max(1, parseInt(overrideConcurrency) || 3);
    } else {
        const concurrentStr = await getSetting('concurrentProfiles');
        concurrency = Math.max(1, parseInt(concurrentStr) || 3);
    }
    console.log(`🧵 Использование потоков: ${concurrency}`);

    // 2. Получаем аккаунты для работы
    const accounts = await getAllAccounts('parser');
    if (accounts.length === 0) {
        throw new Error('Нет доступных аккаунтов для выполнения задачи. Пожалуйста, включите "Parser" для одного из аккаунтов.');
    }

    const account = accounts[0];
    const showBrowserStr = await getSetting('showBrowser');
    const isHeadless = showBrowserStr !== 'true' && showBrowserStr !== true;

    console.log(`👤 Используем аккаунт: ${account.name} (ID: ${account.id})`);

    const { browser, context } = await createBrowserContext({
        id: account.id,
        proxy: account.proxy,
        cookies: account.cookies,
        fingerprint: account.fingerprint,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }, isHeadless);

    await optimizeContextForScraping(context);

    let updatedCount = 0;
    let errorCount = 0;
    let currentIndex = 0;
    let isAborted = false;

    // Функция для получения следующего профиля (потокобезопасно в рамках одного процесса Node.js)
    const getNextProfile = () => {
        if (stopRequested || isAborted || currentIndex >= profiles.length) return null;
        return { profile: profiles[currentIndex], index: currentIndex++ };
    };

    const worker = async (workerId) => {
        console.log(`👷 [Поток ${workerId}] Запущен`);
        const page = await context.newPage();

        try {
            while (true) {
                const data = getNextProfile();
                if (!data) break;

                const { profile, index } = data;
                const url = profile.url;
                const username = profile.username || url.split('/').filter(Boolean).pop() || '';
                const displayCount = index + 1;

                if (onProgress) {
                    onProgress({
                        current: displayCount,
                        total: profiles.length,
                        status: `[Поток ${workerId}] Обработка ${username}...`
                    });
                }

                console.log(`[${displayCount}/${profiles.length}] [Поток ${workerId}] Проверка: ${username}`);

                try {
                    // Короткое ожидание перед переходом
                    if (await activeWait(500)) break;

                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

                    if (stopRequested) break;
                    if (await activeWait(1000 + Math.random() * 1000)) break;

                    if (await checkLoginPage(page)) {
                        console.error(`❌ [Поток ${workerId}] Сессия истекла для ${account.name}. Остановка всех потоков.`);
                        isAborted = true;
                        break;
                    }

                    const photoData = await page.evaluate(async (uname) => {
                        let pUrl = '';
                        try {
                            const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
                                headers: { 'X-IG-App-ID': '936619743392459' }
                            });
                            if (res.ok) {
                                const json = await res.json();
                                if (json?.data?.user?.profile_pic_url_hd) {
                                    pUrl = json.data.user.profile_pic_url_hd;
                                }
                            }
                        } catch (e) { }

                        if (!pUrl) {
                            const html = document.documentElement.innerHTML;
                            const matches = [...html.matchAll(/"profile_pic_url_hd":"([^"]+)"/g)];
                            if (matches.length > 0) {
                                const rawUrl = matches[matches.length - 1][1];
                                try {
                                    pUrl = JSON.parse('"' + rawUrl + '"');
                                } catch (e) {
                                    pUrl = rawUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                                }
                            }
                        }

                        if (!pUrl) {
                            const header = document.querySelector('header');
                            if (header) {
                                const img = header.querySelector('img');
                                if (img) pUrl = img.getAttribute('src') || img.src || '';
                            }
                        }
                        return pUrl;
                    }, username);

                    if (photoData) {
                        await db.run(`UPDATE profiles SET photo = ? WHERE url = ?`, [photoData, url]);
                        updatedCount++;
                        console.log(`   ✅ [Поток ${workerId}] Фото обновлено для ${username}`);
                    } else {
                        console.log(`   ⚠️ [Поток ${workerId}] Фото не найдено для ${username}`);
                    }

                    // Интервал между профилями
                    if (await activeWait(2000 + Math.random() * 3000)) break;

                } catch (err) {
                    console.error(`   ❌ [Поток ${workerId}] Ошибка ${username}: ${err.message}`);
                    errorCount++;
                    // Небольшая пауза после ошибки
                    if (await activeWait(2000)) break;
                }
            }
        } catch (workerErr) {
            console.error(`CRITICAL worker error [${workerId}]:`, workerErr);
        } finally {
            console.log(`👷 [Поток ${workerId}] Завершен`);
            await page.close().catch(() => { });
        }
    };

    try {
        const workers = [];
        for (let i = 0; i < concurrency; i++) {
            workers.push(worker(i + 1));
            // Небольшая задержка при запуске потоков для избежания коллизий в браузере
            await new Promise(r => setTimeout(r, 1000));
            if (stopRequested) break;
        }
        await Promise.all(workers);
    } finally {
        await context.close().catch(() => { });
        await browser.close().catch(() => { });
        const finalStatus = stopRequested ? 'ПРЕРВАНО' : 'ЗАВЕРШЕНО';
        console.log(`🏁 ВОССТАНОВЛЕНИЕ ${finalStatus}. Обновлено: ${updatedCount}, Ошибок: ${errorCount}`);
    }

    return { success: true, updatedCount, errorCount, aborted: stopRequested || isAborted };
}

module.exports = { restorePhotos, stopRestorePhotos };
