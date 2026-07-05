/**
 * E2E против реального dist/ig-bot.exe (без стабов).
 *
 * Требования:
 * - dist/ig-bot.exe собран (build.bat) и dist/install.bat выполнен (Playwright browsers)
 * - В dist/config настроены аккаунты с cookies и ролями: parser, index, server
 * - keywords (города/ниши) для фарма доноров
 *
 * Запуск:
 *   npm run test:e2e:dist
 *
 * Env:
 *   E2E_EMAIL / E2E_PASSWORD — логин панели
 *   E2E_PORT — порт dist (default 5000)
 *   E2E_TIMEOUT_MS — таймаут теста (default 3600000)
 *   E2E_PROFILES_TARGET — сколько профилей нафармить (default 5)
 *   E2E_MIN_DONORS — мин. новых доноров (default 1)
 */
const { test, expect } = require('@playwright/test');
const {
  assertDistExists,
  login,
  requireConfiguredAccounts,
  getProfiles,
  getDonorsCount,
  startBot,
  stopBot,
  waitForBotRunning,
  waitForProfilesDelta,
  waitForDonorsDelta,
  waitForMassMessagingDone,
  setDmLimit,
  gotoProfilesFresh,
  locateProfileCard,
  PROFILES_TARGET,
  MIN_DONORS_ADDED,
} = require('./helpers/dist-flow');

const TEST_TIMEOUT = Number(process.env.E2E_TIMEOUT_MS || 3600000);
const FARM_TIMEOUT = Number(process.env.E2E_FARM_TIMEOUT_MS || TEST_TIMEOUT * 0.7);
const DM_TIMEOUT = Number(process.env.E2E_DM_TIMEOUT_MS || 900000);

test.describe('Farm flow E2E (dist, real bots)', () => {
  test.setTimeout(TEST_TIMEOUT);

  test.beforeAll(() => {
    assertDistExists();
  });

  test('фарм доноров → фарм профилей → лайк/дизлайк → массовая рассылка', async ({
    page,
    request,
  }) => {
    const token = await login(page);
    expect(token).toBeTruthy();

    await requireConfiguredAccounts(request, token);

    const baselineList = await getProfiles(request, token);
    const baselineProfiles = baselineList.length;
    const baselineDonors = await getDonorsCount(request, token);
    const baselineUrls = new Set(baselineList.map((p) => p.url));

    console.log(`Baseline: ${baselineProfiles} profiles, ${baselineDonors} donors`);

    // --- 1. Фарм доноров (parser) ---
    console.log('Step 1: Real donor farming (parser)');
    await page.click('button:has-text("Управление"), button:has-text("Execution")');

    await startBot(request, token, 'parser');
    await waitForBotRunning(request, token, 'parser');

    const donorsAfter = await waitForDonorsDelta(
      request,
      token,
      baselineDonors,
      MIN_DONORS_ADDED,
      FARM_TIMEOUT
    );
    expect(donorsAfter).toBeGreaterThanOrEqual(baselineDonors + MIN_DONORS_ADDED);
    await stopBot(request, token, 'parser');
    console.log(`Donors: ${baselineDonors} → ${donorsAfter}`);

    // --- 2. Фарм профилей (index) ---
    console.log(`Step 2: Real profile farming (+${PROFILES_TARGET})`);
    await startBot(request, token, 'index');
    await waitForBotRunning(request, token, 'index');

    const profiles = await waitForProfilesDelta(
      request,
      token,
      baselineProfiles,
      PROFILES_TARGET,
      FARM_TIMEOUT,
      baselineUrls
    );
    const addedProfiles = profiles.filter((p) => !baselineUrls.has(p.url));
    expect(addedProfiles.length).toBeGreaterThanOrEqual(PROFILES_TARGET);
    await stopBot(request, token, 'index');
    console.log(`Profiles: ${baselineProfiles} → ${profiles.length} (+${addedProfiles.length})`);

    const likedProfile = addedProfiles[0];
    const dislikedProfile = addedProfiles[1];
    expect(likedProfile).toBeTruthy();
    expect(dislikedProfile).toBeTruthy();

    // --- 3. UI: профили на месте ---
    console.log('Step 3: Verify profiles in UI');
    await gotoProfilesFresh(page);
    await locateProfileCard(page, likedProfile);
    await locateProfileCard(page, dislikedProfile);

    // --- 4. Лайк / дизлайк ---
    console.log('Step 4: Like / dislike');
    const likedCard = await locateProfileCard(page, likedProfile);
    await likedCard.locator('.likeBtn').click();
    await expect(likedCard).toHaveClass(/status-like/);

    const dislikedCard = await locateProfileCard(page, dislikedProfile);
    await dislikedCard.locator('.dislikeBtn').click();
    await expect(dislikedCard).toHaveClass(/status-dislike/);

    const votesRes = await request.get(`${process.env.E2E_BACKEND_URL || 'http://127.0.0.1:5000'}/api/votes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const votes = await votesRes.json();
    expect(votes[likedProfile.url]).toBe('like');
    expect(votes[dislikedProfile.url]).toBe('dislike');

    // --- 5. Массовая рассылка: 1 ЛС только лайкнутому ---
    console.log('Step 5: Real mass DM (1 message, liked only)');
    await setDmLimit(request, token, 1);
    await page.locator('select.select-input').first().selectOption('like');
    await page.waitForTimeout(500);

    const massBtn = page.locator('button').filter({ hasText: /Массовая рассылка|Mass/i });
    await massBtn.click();

    await waitForMassMessagingDone(request, token, DM_TIMEOUT);

    const finalProfiles = await getProfiles(request, token);
    const likedRow = finalProfiles.find((p) => p.url === likedProfile.url);
    const dislikedRow = finalProfiles.find((p) => p.url === dislikedProfile.url);
    const others = addedProfiles.slice(2);

    expect(likedRow?.dmSent).toBe(1);
    expect(dislikedRow?.dmSent || 0).toBe(0);
    for (const p of others) {
      const row = finalProfiles.find((x) => x.url === p.url);
      expect(row?.dmSent || 0).toBe(0);
    }

    const sentTotal = addedProfiles.filter((p) => {
      const row = finalProfiles.find((x) => x.url === p.url);
      return row?.dmSent === 1;
    });
    expect(sentTotal.length).toBe(1);

    await page.reload();
    await page.waitForTimeout(1500);

    const likedCardFinal = await locateProfileCard(page, likedProfile);
    await expect(likedCardFinal.locator('.badge.dmTag, .badge:has-text("Написал")')).toBeVisible({
      timeout: 30000,
    });
    const dislikedCardFinal = await locateProfileCard(page, dislikedProfile);
    await expect(dislikedCardFinal.locator('.badge.dmTag, .badge:has-text("Написал")')).toHaveCount(0);

    console.log('Dist farm flow E2E passed');
  });
});
