"use strict";
const { getDB } = require("./lib/db");
const { createBrowserContext, checkLoginPage } = require("./lib/browser");
const { getSetting, getAllAccounts } = require("./lib/config");
const { wait } = require("./lib/utils");

async function checkAccounts() {
    console.log('🚀 ЗАПУСК ПРОВЕРКИ АККАУНТОВ...');
    const db = await getDB();
    const accounts = await getAllAccounts('checker');

    if (accounts.length === 0) {
        console.log('⚠️ Нет выбранных аккаунтов для проверки.');
        return;
    }

    const concurrentStr = await getSetting('concurrentProfiles');
    const concurrency = Math.max(1, parseInt(concurrentStr) || 3);
    console.log(`🎯 Аккаунтов для проверки: ${accounts.length}. Параллельно: ${concurrency}`);

    let currentIndex = 0;
    const results = { valid: 0, invalid: 0, errors: 0 };

    const worker = async (workerId) => {
        while (currentIndex < accounts.length) {
            const account = accounts[currentIndex++];
            if (!account) break;

            console.log(`[Поток ${workerId}] Проверка аккаунта: ${account.name}`);

            let browser, context;
            try {
                const showBrowserStr = await getSetting('showBrowser');
                const isHeadless = showBrowserStr !== 'true' && showBrowserStr !== true;

                const result = await createBrowserContext({
                    id: account.id,
                    proxy: account.proxy,
                    cookies: account.cookies,
                    fingerprint: account.fingerprint,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }, isHeadless);

                browser = result.browser;
                context = result.context;

                const page = await context.newPage();
                await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
                await wait(2000);

                const isLoginNeeded = await checkLoginPage(page);

                if (isLoginNeeded) {
                    console.log(`   ❌ Аккаунт ${account.name}: ТРЕБУЕТСЯ ЛОГИН (Сессия истекла)`);
                    results.invalid++;
                } else {
                    console.log(`   ✅ Аккаунт ${account.name}: АВТОРИЗОВАН`);
                    results.valid++;
                }

            } catch (err) {
                console.error(`   💥 Ошибка проверки аккаунта ${account.name}: ${err.message}`);
                results.errors++;
            } finally {
                if (context) await context.close().catch(() => { });
                if (browser) await browser.close().catch(() => { });
            }
        }
    };

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, accounts.length); i++) {
        workers.push(worker(i + 1));
        await new Promise(r => setTimeout(r, 1500));
    }

    await Promise.all(workers);
    console.log(`\n🏁 ПРОВЕРКА ЗАВЕРШЕНА. Успешно: ${results.valid}, Истекло: ${results.invalid}, Ошибок: ${results.errors}`);
}

if (require.main === module) {
    checkAccounts().catch(console.error);
}

module.exports = { checkAccounts };
