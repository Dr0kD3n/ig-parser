'use strict';
const { getDB } = require('./db');
const {
  createBrowserContext,
  optimizeContextForScraping,
  takeLiveScreenshot,
  checkLoginPage,
} = require('./browser');
const { wait } = require('./utils');
const { saveCrashReport } = require('./reporter');
const { getSetting, getAllAccounts, getList } = require('./config');

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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function restorePhotos(onProgress, options = {}) {
  const { overrideConcurrency, accountId, existingContext, failedUrls } = options;
  stopRequested = false;
  console.log('🚀 ЗАПУСК ВОССТАНОВЛЕНИЯ ФОТО...');
  const db = await getDB();

  // 1. Получаем активные профили (vote != 'dislike')
  const femaleNames = await getList('names.txt');
  const allProfiles = await db.all(
    `SELECT url, username, name, photo, bio, vote FROM profiles WHERE vote != 'dislike'`
  );

  // Получаем список доноров, у которых нет фото
  const donorsWithoutPhoto = await db.all(
    `SELECT username as name, photo, bio FROM donors WHERE photo IS NULL OR photo = '' OR photo LIKE '%placeholder%'`
  );
  const donorUsernames = donorsWithoutPhoto.map((d) => d.name);

  const profiles = allProfiles.filter((p) => {
    const isFailed = failedUrls && Array.isArray(failedUrls) && failedUrls.includes(p.url);
    const hasNoPhoto =
      !p.photo ||
      p.photo === '' ||
      (typeof p.photo === 'string' && p.photo.includes('placeholder'));
    const hasNoBio = !p.bio || p.bio.trim() === '' || p.bio.trim() === '.';
    const isLiked = p.vote === 'like';

    const nameMatches =
      femaleNames.length === 0 ||
      femaleNames.some(
        (name) =>
          (p.name && p.name.toLowerCase().includes(name.toLowerCase())) ||
          (p.username && p.username.toLowerCase().includes(name.toLowerCase()))
      );

    // Также проверяем, не является ли этот профиль донором без фото
    const isDonorWithoutPhoto = p.username && donorUsernames.includes(p.username);

    return (
      (isFailed || hasNoPhoto || hasNoBio || isDonorWithoutPhoto) &&
      (nameMatches || isLiked || isDonorWithoutPhoto)
    );
  });

  // Добавляем доноров, которых нет в списке profiles (по url)
  for (const donor of donorsWithoutPhoto) {
    const donorUrl = `https://www.instagram.com/${donor.name}/`;
    if (!profiles.some((p) => p.url === donorUrl)) {
      profiles.push({
        url: donorUrl,
        username: donor.name,
        name: donor.name,
        photo: donor.photo,
        bio: donor.bio,
        is_donor_only: true,
      });
    }
  }

  if (profiles.length === 0) {
    console.log('⚠️ Нет подходящих профилей (девушек без фото) для восстановления.');
    return { success: true, count: 0 };
  }

  console.log(`🎯 Найдено профилей для проверки: ${profiles.length}`);

  // Get concurrency setting
  let concurrency = 3;
  if (existingContext) {
    concurrency = 1; // Only one worker if using existing context
  } else if (overrideConcurrency) {
    concurrency = Math.max(1, parseInt(overrideConcurrency) || 3);
  } else {
    const concurrentStr = await getSetting('concurrentProfiles');
    concurrency = Math.max(1, parseInt(concurrentStr) || 3);
  }
  console.log(`🧵 Использование потоков: ${concurrency}`);

  // 2. Получаем аккаунты для работы
  let account;
  if (accountId) {
    account = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
  } else {
    const accounts = await getAllAccounts('parser');
    if (accounts.length === 0) {
      throw new Error(
        'Нет доступных аккаунтов для выполнения задачи. Пожалуйста, включите "Parser" для одного из аккаунтов.'
      );
    }
    account = accounts[0];
  }

  if (!account) throw new Error('Аккаунт не найден');

  const showBrowserStr = await getSetting('showBrowser');
  const isHeadless = showBrowserStr !== 'true' && showBrowserStr !== true;

  console.log(`👤 Используем аккаунт: ${account.name} (ID: ${account.id})`);

  let browser, context;

  if (existingContext) {
    context = existingContext;
  } else {
    const result = await createBrowserContext(
      {
        id: account.id,
        proxy: account.proxy,
        cookies: account.cookies,
        fingerprint: account.fingerprint,
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      isHeadless
    );
    browser = result.browser;
    context = result.context;
  }

  if (!existingContext) {
    await optimizeContextForScraping(context);
  }

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
            status: `[Поток ${workerId}] Обработка ${username}...`,
          });
        }

        console.log(
          `[${displayCount}/${profiles.length}] [Поток ${workerId}] Проверка: ${username}`
        );

        try {
          // Короткое ожидание перед переходом
          if (await activeWait(500)) break;

          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

          if (stopRequested) break;
          if (await activeWait(1000 + Math.random() * 1000)) break;

          if (await checkLoginPage(page)) {
            console.error(
              `❌ [Поток ${workerId}] Сессия истекла для ${account.name}. Остановка всех потоков.`
            );
            isAborted = true;
            break;
          }

          const profileData = await page.evaluate(async (uname) => {
            let result = {
              photo: '',
              bio: '',
              followers: 0,
              following: 0,
              publications: 0,
              name: '',
            };
            try {
              const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
                headers: { 'X-IG-App-ID': '936619743392459' },
              });
              if (res.ok) {
                const json = await res.json();
                const user = json?.data?.user;
                if (user) {
                  result.photo = user.profile_pic_url_hd || '';
                  result.bio = user.biography || '';
                  result.followers = user.edge_followed_by?.count || 0;
                  result.following = user.edge_follow?.count || 0;
                  result.publications = user.edge_owner_to_timeline_media?.count || 0;
                  result.name = user.full_name || '';
                }
              }
            } catch (e) {}

            if (!result.photo) {
              const html = document.documentElement.innerHTML;
              const matches = [...html.matchAll(/"profile_pic_url_hd":"([^"]+)"/g)];
              if (matches.length > 0) {
                const rawUrl = matches[matches.length - 1][1];
                try {
                  result.photo = JSON.parse('"' + rawUrl + '"');
                } catch (e) {
                  result.photo = rawUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                }
              }
            }

            if (!result.photo) {
              const header = document.querySelector('header');
              if (header) {
                const img = header.querySelector('img');
                if (img) result.photo = img.getAttribute('src') || img.src || '';
              }
            }

            if (!result.bio) {
              const bioEl = document.querySelector(
                'header section h1 + div, header section div:nth-child(3) span'
              );
              if (bioEl) result.bio = bioEl['textContent'] || bioEl['innerText'] || '';
            }

            return result;
          }, username);

          if (profileData.photo || profileData.bio) {
            // Обновляем в таблице profiles
            await db.run(
              `UPDATE profiles SET 
                                photo = COALESCE(NULLIF(?, ''), photo), 
                                bio = COALESCE(NULLIF(?, ''), bio), 
                                followers_count = CASE WHEN ? > 0 THEN ? ELSE followers_count END,
                                following_count = CASE WHEN ? > 0 THEN ? ELSE following_count END,
                                publications_count = CASE WHEN ? > 0 THEN ? ELSE publications_count END,
                                name = COALESCE(NULLIF(?, ''), name),
                                timestamp = ?
                             WHERE url = ? OR username = ?`,
              [
                profileData.photo,
                profileData.bio,
                profileData.followers,
                profileData.followers,
                profileData.following,
                profileData.following,
                profileData.publications,
                profileData.publications,
                profileData.name,
                new Date().toISOString(),
                url,
                username,
              ]
            );

            // Также обновляем в таблице donors, если такой существует
            await db.run(
              `UPDATE donors SET 
                                photo = COALESCE(NULLIF(?, ''), photo), 
                                bio = COALESCE(NULLIF(?, ''), bio), 
                                followers_count = CASE WHEN ? > 0 THEN ? ELSE followers_count END,
                                publications_count = CASE WHEN ? > 0 THEN ? ELSE publications_count END,
                                name = COALESCE(NULLIF(?, ''), name),
                                last_updated = ?
                             WHERE username = ?`,
              [
                profileData.photo,
                profileData.bio,
                profileData.followers,
                profileData.publications,
                profileData.name,
                new Date().toISOString(),
                username,
              ]
            );
            updatedCount++;
            console.log(
              `   ✅ [Поток ${workerId}] Профиль и данные донора обновлены для ${username}`
            );
          } else {
            console.log(`   ⚠️ [Поток ${workerId}] Данные не найдены для ${username}`);
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
      await page.close().catch(() => {});
    }
  };

  try {
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker(i + 1));
      // Небольшая задержка при запуске потоков для избежания коллизий в браузере
      await new Promise((r) => setTimeout(r, 1000));
      if (stopRequested) break;
    }
    await Promise.all(workers);
  } finally {
    if (!existingContext) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
    const finalStatus = stopRequested ? 'ПРЕРВАНО' : 'ЗАВЕРШЕНО';
    console.log(
      `🏁 ВОССТАНОВЛЕНИЕ ${finalStatus}. Обновлено: ${updatedCount}, Ошибок: ${errorCount}`
    );
  }

  return { success: true, updatedCount, errorCount, aborted: stopRequested || isAborted };
}

module.exports = { restorePhotos, stopRestorePhotos };
