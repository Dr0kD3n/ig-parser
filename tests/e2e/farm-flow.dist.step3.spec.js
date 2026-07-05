/**
 * Изолированный прогон Step 3: проверка профилей в UI.
 * Требует запущенный dist с профилями в БД.
 *
 *   npx playwright test -c playwright.dist.config.js tests/e2e/farm-flow.dist.step3.spec.js
 */
const { test, expect } = require('@playwright/test');
const {
  assertDistExists,
  login,
  getProfiles,
  gotoProfilesFresh,
  locateProfileCard,
} = require('./helpers/dist-flow');

test.describe('Step 3 only — profiles in UI', () => {
  test.setTimeout(120000);

  test.beforeAll(() => {
    assertDistExists();
  });

  test('verify farmed profiles visible in UI', async ({ page, request }) => {
    const token = await login(page);
    expect(token).toBeTruthy();

    const profiles = await getProfiles(request, token);
    expect(profiles.length).toBeGreaterThan(0);

    const a = profiles[0];
    const b = profiles[1] || profiles[0];
    console.log(`Profile A: ${a.name} (@${a.username || '?'})`);
    console.log(`Profile B: ${b.name} (@${b.username || '?'})`);

    console.log('Step 3: Verify profiles in UI');
    await gotoProfilesFresh(page);

    const cardA = await locateProfileCard(page, a);
    await expect(cardA).toBeVisible();

    const cardB = await locateProfileCard(page, b);
    await expect(cardB).toBeVisible();
    console.log('Step 3 passed');
  });
});
