const { test, expect } = require('@playwright/test');
const {
  resetE2eState,
  getE2eState,
  waitForBotIdle,
  waitForProfilesCount,
  waitForDonorsCount,
  waitForMassMessagingDone,
} = require('./helpers/farm-flow');

test.describe('Farm flow E2E', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page, request }) => {
    await resetE2eState(request);

    await page.addInitScript(() => {
      localStorage.setItem('ig_user', JSON.stringify({ id: 1, email: 'e2e@test.com', role: 'admin' }));
      localStorage.setItem('ig_token', 'e2e-test-token');
      localStorage.setItem('ig_filter_status', 'all');
      localStorage.setItem('ig_city_only', 'false');
      localStorage.setItem('ig_except_city', 'false');
    });

    page.on('console', (msg) => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));

    const settingsPromise = page
      .waitForResponse((r) => r.url().includes('/api/settings') && r.method() === 'GET', {
        timeout: 30000,
      })
      .catch(() => null);

    await page.goto('/');
    await settingsPromise;
    await expect(page.locator('.header .tab-btn, nav .tab-btn').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('фарм доноров → фарм 5 профилей → лайк/дизлайк → массовая рассылка 1 ЛС', async ({
    page,
    request,
  }) => {
    // --- 1. Фарм доноров (parser) ---
    console.log('Step 1: Donor farming');
    await page.click('button:has-text("Управление"), button:has-text("Execution")');

    const parserCard = page.locator('.control-card').filter({ hasText: 'Фарм доноров' });
    await parserCard.locator('button:has-text("Запустить")').click();

    await waitForBotIdle(request, 'parser');
    const donorsState = await waitForDonorsCount(request, 2);
    expect(donorsState.donorsCount).toBeGreaterThanOrEqual(2);
    console.log(`Donors farmed: ${donorsState.donorsCount}`);

    // --- 2. Фарм профилей (index), 5 шт ---
    console.log('Step 2: Profile farming');
    const scraperCard = page.locator('.control-card').filter({ hasText: 'Фарм профилей' });
    await scraperCard.locator('button:has-text("Запустить")').click();

    await waitForBotIdle(request, 'index');
    const profilesState = await waitForProfilesCount(request, 5);
    expect(profilesState.profilesCount).toBe(5);

    const likedProfile = profilesState.profiles[0];
    const dislikedProfile = profilesState.profiles[1];
    console.log(`Profiles farmed: ${profilesState.profilesCount}`);

    // --- 3. Проверка профилей в UI ---
    console.log('Step 3: Verify profiles in UI');
    await page.click('button:has-text("Профили"), button:has-text("Profiles")');
    await expect(page.locator('.card')).toHaveCount(5, { timeout: 15000 });

    const likedCard = page.locator('.card').filter({ hasText: likedProfile.name });
    const dislikedCard = page.locator('.card').filter({ hasText: dislikedProfile.name });

    // --- 4. Лайк 1 профиля, дизлайк 1 профиля ---
    console.log('Step 4: Like / dislike');
    const likePromise = page.waitForResponse(
      (r) => r.url().includes('/api/vote') && r.request().method() === 'POST'
    );
    await likedCard.locator('.likeBtn').click();
    await likePromise;
    await expect(likedCard).toHaveClass(/status-like/);

    const dislikePromise = page.waitForResponse(
      (r) => r.url().includes('/api/vote') && r.request().method() === 'POST'
    );
    await dislikedCard.locator('.dislikeBtn').click();
    await dislikePromise;
    await expect(dislikedCard).toHaveClass(/status-dislike/);

    const votesRes = await request.get('http://127.0.0.1:1337/api/votes');
    const votes = await votesRes.json();
    expect(votes[likedProfile.url]).toBe('like');
    expect(votes[dislikedProfile.url]).toBe('dislike');

    // --- 5. Массовая рассылка только лайкнутым (1 сообщение) ---
    console.log('Step 5: Mass messaging to liked profile only');
    await page.locator('select.select-input').first().selectOption('like');
    await page.waitForTimeout(300);

    const massBtn = page.locator('button').filter({ hasText: /Массовая рассылка|Mass/i });
    await expect(massBtn).toBeVisible();
    await massBtn.click();

    await waitForMassMessagingDone(request);

    const finalState = await getE2eState(request);
    const likedRow = finalState.profiles.find((p) => p.url === likedProfile.url);
    const dislikedRow = finalState.profiles.find((p) => p.url === dislikedProfile.url);
    const otherProfiles = finalState.profiles.filter(
      (p) => p.url !== likedProfile.url && p.url !== dislikedProfile.url
    );

    expect(likedRow?.dmSent).toBe(1);
    expect(dislikedRow?.dmSent || 0).toBe(0);
    for (const p of otherProfiles) {
      expect(p.dmSent || 0).toBe(0);
    }

    expect(finalState.profiles.filter((p) => p.dmSent === 1).length).toBe(1);

    await page.reload();
    await page
      .waitForResponse((r) => r.url().includes('/api/girls') && r.method() === 'GET')
      .catch(() => null);

    await expect(likedCard.locator('.badge.dmTag, .badge:has-text("Написал")')).toBeVisible({
      timeout: 10000,
    });
    await expect(dislikedCard.locator('.badge.dmTag, .badge:has-text("Написал")')).toHaveCount(0);

    console.log('Farm flow E2E passed');
  });
});
