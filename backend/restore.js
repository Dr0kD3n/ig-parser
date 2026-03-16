"use strict";
const { getDB } = require("./lib/db");
const { getAllAccounts, getSetting } = require("./lib/config");
const { StateManager } = require("./lib/state");
const { createBrowserContext, startLiveView, takeLiveScreenshot } = require("./lib/browser");
const { wait, shuffleArray } = require("./lib/utils");
const logger = require("./lib/logger");
const { saveCrashReport } = require("./lib/reporter");

const isAnonymousPhoto = (url) => {
    if (!url) return true;
    // Base64 of 'anonymous_profile_pic' in ig_cache_key
    if (url.includes('YW5vbnltb3VzX3Byb2ZpbGVfcGlj')) return true;
    // Common default/anonymous avatar patterns
    if (/\/\d+_\d+_\d+_n\.(jpg|png)/.test(url) === false && url.includes('anonymous')) return true;
    // Very small default profile pics (44x44, 110x110, 150x150)
    if (url.includes('s150x150') && url.includes('_nc_cat=1&')) return false; // real pic
    return false;
};

const getDynamicConfig = async () => {
    const width = 1280 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);
    return {
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 30000, element: 15000 }
    };
};

const refreshProfile = async (context, profile, config) => {
    const page = await context.newPage();
    const url = profile.url;
    logger.info(`      🔄 Обновляем фото для: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });
        await takeLiveScreenshot(page);
        await page.waitForSelector('header', { timeout: 15000 });
        // Wait for profile image to appear in the header
        await page.waitForSelector('header img', { timeout: 10000 }).catch(() => { });
        // Give extra time for the IG API to respond with HD photo data
        await wait(3000 + Math.random() * 1000);

        const username = url.split('/').filter(Boolean).pop() || '';

        const data = await page.evaluate(async (uname) => {
            let pUrl = '';
            let fCount = 0;
            let postCount = 0;
            let bio = '';
            let name = uname;

            try {
                // Try API first
                const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
                    headers: { 'X-IG-App-ID': '936619743392459' }
                });
                if (res.ok) {
                    const json = await res.json();
                    if (json?.data?.user) {
                        const u = json.data.user;
                        pUrl = u.profile_pic_url_hd || u.profile_pic_url || '';
                        fCount = u.edge_followed_by?.count || 0;
                        postCount = u.edge_owner_to_timeline_media?.count || 0;
                        bio = u.biography || '';
                        name = u.full_name || uname;
                    }
                }
            } catch (e) { }

            if (!pUrl) {
                // Fallback to HTML scraping
                const html = document.documentElement.innerHTML;
                const matches = [...html.matchAll(/"profile_pic_url_hd":"([^"]+)"/g)];
                if (matches.length > 0) {
                    const rawUrl = matches[matches.length - 1][1];
                    try { pUrl = JSON.parse('"' + rawUrl + '"'); } catch (e) {
                        pUrl = rawUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    }
                }
            }

            if (!pUrl) {
                const img = document.querySelector('header img');
                if (img) pUrl = img.getAttribute('src') || '';
            }

            if (!bio) {
                const header = document.querySelector('header');
                if (header) {
                    const ulList = header.querySelector('ul');
                    if (ulList && ulList.nextElementSibling) {
                        bio = ulList.nextElementSibling.textContent || '';
                    }
                }
            }

            return { pUrl, fCount, postCount, bio, name };
        }, username).catch(() => ({ pUrl: '', fCount: 0, postCount: 0, bio: '', name: username }));

        const db = await (require("./lib/db")).getDB();
        const ts = new Date().toISOString();
        const existing = await db.get(`SELECT * FROM profiles WHERE url = ?`, [url]);

        // Determine the best photo to save
        let photoToSave = existing?.photo || '';
        if (data.pUrl && !isAnonymousPhoto(data.pUrl)) {
            photoToSave = data.pUrl;
        } else if (data.pUrl && isAnonymousPhoto(data.pUrl)) {
            logger.warn(`         ⚠️ Найдена анонимная/дефолтная аватарка, сохраняем старое фото.`);
        }

        // Use new data if available, otherwise keep existing
        const finalName = data.name || existing?.name || username;
        const finalBio = data.bio || existing?.bio || '';
        const finalFollowers = data.fCount || existing?.followers_count || 0;
        const finalPosts = data.postCount || existing?.publications_count || existing?.posts_count || 0;

        await db.run(
            `UPDATE profiles SET photo = ?, name = ?, username = ?, bio = ?, followers_count = ?, publications_count = ?, posts_count = ?, timestamp = ? WHERE url = ?`,
            [photoToSave, finalName, username, finalBio, finalFollowers, finalPosts, finalPosts, ts, url]
        );

        const updated = [];
        if (photoToSave && photoToSave !== (existing?.photo || '')) updated.push('фото');
        if (finalName !== (existing?.name || '')) updated.push('имя');
        if (finalBio && finalBio !== (existing?.bio || '')) updated.push('био');
        if (finalFollowers && finalFollowers !== (existing?.followers_count || 0)) updated.push('подписчики');
        if (finalPosts && finalPosts !== (existing?.publications_count || 0)) updated.push('публикации');

        if (updated.length > 0) {
            logger.info(`         ✅ Обновлено: ${updated.join(', ')}`);
        } else {
            logger.warn(`         ⚠️ Не удалось получить новые данные.`);
        }
    } catch (e) {
        logger.error(`         ❌ Ошибка: ${e.message.split('\n')[0]}`);
        await saveCrashReport(page, e, `restore_${url.split('/').filter(Boolean).pop()}`);
    } finally {
        await page.close().catch(() => { });
    }
};

const run = async () => {
    logger.info('🚀 ЗАПУСК ВОССТАНОВЛЕНИЯ ДАННЫХ ПРОФИЛЕЙ...');
    logger.info('----------------------------------------------');

    await StateManager.init();
    const db = await getDB();
    // Find profiles missing ANY key data: photo, bio, followers, or publications
    const profiles = await db.all(`
        SELECT url FROM profiles 
        WHERE (photo IS NULL OR photo = '') 
           OR (bio IS NULL OR bio = '')
           OR (followers_count IS NULL OR followers_count = 0)
           OR (publications_count IS NULL OR publications_count = 0)
        ORDER BY 
            CASE WHEN (photo IS NULL OR photo = '') AND (followers_count IS NULL OR followers_count = 0) THEN 0 ELSE 1 END,
            timestamp ASC
    `);

    if (profiles.length === 0) {
        logger.info('✅ У всех профилей уже есть полные данные. Нечего восстанавливать.');
        return;
    }

    const totalProfiles = await db.get(`SELECT COUNT(*) as cnt FROM profiles`);
    const noPhoto = await db.get(`SELECT COUNT(*) as cnt FROM profiles WHERE photo IS NULL OR photo = ''`);
    const noFollowers = await db.get(`SELECT COUNT(*) as cnt FROM profiles WHERE followers_count IS NULL OR followers_count = 0`);
    const noBio = await db.get(`SELECT COUNT(*) as cnt FROM profiles WHERE bio IS NULL OR bio = ''`);
    logger.info(`🎯 Профилей с неполными данными: ${profiles.length} из ${totalProfiles.cnt}`);
    logger.info(`   📷 Без фото: ${noPhoto.cnt}`);
    logger.info(`   👥 Без подписчиков: ${noFollowers.cnt}`);
    logger.info(`   📝 Без био: ${noBio.cnt}`);

    const accounts = await getAllAccounts('parser');
    if (accounts.length === 0) {
        logger.error('❌ Нет доступных аккаунтов для парсера. Проверьте настройки.');
        return;
    }

    const account = accounts[0];
    logger.info(`🌐 Запуск браузера для аккаунта: ${account.name}...`);

    const config = await getDynamicConfig();
    const showBrowserStr = await getSetting('showBrowser');
    const isHeadless = !(showBrowserStr === 'true' || showBrowserStr === true);

    const { browser, context } = await createBrowserContext({
        ...config,
        id: account.id,
        proxy: account.proxy,
        cookies: account.cookies,
        fingerprint: account.fingerprint
    }, isHeadless);

    // NOTE: Do NOT call optimizeContextForScraping here — restore needs images to load!
    const liveViewInterval = startLiveView(context);

    const concurrentProfiles = await getSetting('concurrentProfiles');
    const CHUNK_SIZE = parseInt(concurrentProfiles) || 3;

    logger.info(`🚀 Обработка по ${CHUNK_SIZE} профиля(ей) параллельно...`);

    for (let i = 0; i < profiles.length; i += CHUNK_SIZE) {
        const chunk = profiles.slice(i, i + CHUNK_SIZE);
        logger.info(`📦 Пачка ${Math.floor(i / CHUNK_SIZE) + 1} / ${Math.ceil(profiles.length / CHUNK_SIZE)}`);

        await Promise.all(chunk.map(profile => refreshProfile(context, profile, config)));

        // Small delay between chunks to be safe
        await wait(2000 + Math.random() * 2000);
    }

    clearInterval(liveViewInterval);
    await browser.close();
    logger.info('\n✅ ========================================== ✅');
    logger.info('👋 ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!');
    logger.info('✅ ========================================== ✅');
};

run().catch(err => {
    logger.error(`💥 КРИТИЧЕСКАЯ ОШИБКА: ${err.message}`);
    process.exit(1);
});
