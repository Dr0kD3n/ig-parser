'use strict';
const { getDB } = require('./db');
const { createBrowserContext, optimizeContextForScraping, checkLoginPage } = require('./browser');
const { getSetting, getAllAccounts } = require('./config');
const { cacheProfilePhotoFromPage, isAnonymousPhotoUrl } = require('./photo-cache');

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
  const { overrideConcurrency, accountId, existingContext } = options;
  stopRequested = false;
  console.log('🚀 ЗАПУСК ВОССТАНОВЛЕНИЯ ФОТО...');
  const db = await getDB();

  // 1. Берем только те профили, у которых картинки не загрузились
  const failedRecords = await db.all(`SELECT url FROM failed_images`);

  if (failedRecords.length === 0) {
    console.log('⚠️ В таблице failed_images нет ссылок для восстановления.');
    return { success: true, count: 0 };
  }

  // Превращаем в массив чистых объектов для пула воркеров
  const profiles = failedRecords.map((rec) => {
    const username = rec.url.split('/').filter(Boolean).pop() || '';
    return {
      url: rec.url,
      username: username,
      name: username,
    };
  });

  console.log(`🎯 Найдено битых ссылок для проверки: ${profiles.length}`);

  // Get concurrency setting
  let concurrency = 3;
  if (existingContext) {
    concurrency = 1;
  } else if (overrideConcurrency) {
    concurrency = Math.max(1, parseInt(overrideConcurrency) || 3);
  } else {
    const concurrentStr = await getSetting('concurrentProfiles');
    concurrency = Math.max(1, parseInt(concurrentStr) || 3);
  }
  console.log(`🧵 Использование потоков: ${concurrency}`);

  // 2. Получаем аккаунт для работы
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
        viewport: { width: 1920, height: 800 },
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
        const username = profile.username;
        const displayCount = index + 1;

        if (onProgress) {
          onProgress({
            current: displayCount,
            total: profiles.length,
            status: `[Поток ${workerId}] Перепарсинг ${username}...`,
          });
        }

        console.log(
          `[${displayCount}/${profiles.length}] [Поток ${workerId}] Перепроверка: ${username}`
        );

        try {
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
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const res = await fetch(
                  `/api/v1/users/web_profile_info/?username=${encodeURIComponent(uname)}`,
                  {
                    headers: { 'X-IG-App-ID': '936619743392459' },
                  }
                );
                if (res.ok) {
                  const json = await res.json();
                  const user = json?.data?.user;
                  if (user) {
                    result.photo = user.profile_pic_url_hd || user.profile_pic_url || '';
                    result.bio = user.biography || '';
                    result.followers = user.edge_followed_by?.count || 0;
                    result.following = user.edge_follow?.count || 0;
                    result.publications = user.edge_owner_to_timeline_media?.count || 0;
                    result.name = user.full_name || '';
                    break;
                  }
                }
              } catch {
                // Retry transient Instagram API failures below.
              }
              if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
              }
            }

            if (!result.photo) {
              result.photo =
                document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
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

          // Проверяем, удалось ли на этот раз найти фото (или хотя бы био)
          if (profileData.photo && !isAnonymousPhotoUrl(profileData.photo)) {
            const photoCache = await cacheProfilePhotoFromPage(page, profileData.photo).catch(
              (e) => ({
                success: false,
                status: 'failed',
                error: e.message,
              })
            );

            // 1. Обновляем основную таблицу profiles
            await db.run(
              `UPDATE profiles SET 
                    photo = ?, 
                    photo_local = COALESCE(NULLIF(?, ''), photo_local),
                    photo_cached_at = COALESCE(?, photo_cached_at),
                    photo_status = ?,
                    bio = COALESCE(NULLIF(?, ''), bio), 
                    followers_count = CASE WHEN ? > 0 THEN ? ELSE followers_count END,
                    following_count = CASE WHEN ? > 0 THEN ? ELSE following_count END,
                    publications_count = CASE WHEN ? > 0 THEN ? ELSE publications_count END,
                    name = COALESCE(NULLIF(?, ''), name)
                 WHERE url = ? OR username = ?`,
              [
                profileData.photo,
                photoCache.localPath || '',
                photoCache.cachedAt || null,
                photoCache.status || 'failed',
                profileData.bio,
                profileData.followers,
                profileData.followers,
                profileData.following,
                profileData.following,
                profileData.publications,
                profileData.publications,
                profileData.name,
                url,
                username,
              ]
            );

            // 2. Обновляем таблицу доноров
            await db.run(
              `UPDATE donors SET 
                    photo = ?, 
                    photo_local = COALESCE(NULLIF(?, ''), photo_local),
                    photo_cached_at = COALESCE(?, photo_cached_at),
                    photo_status = ?,
                    bio = COALESCE(NULLIF(?, ''), bio), 
                    followers_count = CASE WHEN ? > 0 THEN ? ELSE followers_count END,
                    publications_count = CASE WHEN ? > 0 THEN ? ELSE publications_count END,
                    name = COALESCE(NULLIF(?, ''), name),
                    last_updated = ?
                 WHERE username = ?`,
              [
                profileData.photo,
                photoCache.localPath || '',
                photoCache.cachedAt || null,
                photoCache.status || 'failed',
                profileData.bio,
                profileData.followers,
                profileData.followers,
                profileData.publications,
                profileData.publications,
                profileData.name,
                new Date().toISOString(),
                username,
              ]
            );

            if (photoCache.success) {
              // 3. УДАЛЯЕМ ИЗ СПИСКА ОШИБОК, так как фото сохранено локально
              await db.run(`DELETE FROM failed_images WHERE url = ?`, [url]);
              updatedCount++;
              console.log(`   ✅ [Поток ${workerId}] Фото восстановлено локально: ${username}`);
            } else {
              console.log(
                `   ⚠️ [Поток ${workerId}] URL фото найден, но локально не сохранен: ${username}`
              );
            }
          } else {
            console.log(`   ⚠️ [Поток ${workerId}] Фото всё еще не доступно для ${username}`);
          }

          if (await activeWait(2000 + Math.random() * 3000)) break;
        } catch (err) {
          console.error(`   ❌ [Поток ${workerId}] Ошибка ${username}: ${err.message}`);
          errorCount++;
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
      `🏁 ВОССТАНОВЛЕНИЕ ${finalStatus}. Восстановлено фоток: ${updatedCount}, Ошибок: ${errorCount}`
    );
  }

  return { success: true, updatedCount, errorCount, aborted: stopRequested || isAborted };
}

module.exports = { restorePhotos, stopRestorePhotos };
