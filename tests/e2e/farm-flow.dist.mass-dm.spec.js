/**
 * Изолированный тест массовой рассылки в dist.
 *
 *   npx playwright test -c playwright.dist.config.js tests/e2e/farm-flow.dist.mass-dm.spec.js
 *
 * Env:
 *   E2E_DM_TIMEOUT_MS — таймаут рассылки (default 900000)
 */
const { test, expect } = require('@playwright/test');
const {
  assertDistExists,
  login,
  requireSenderAccount,
  prepareMassDmTargets,
  getProfiles,
  setDmLimit,
  gotoProfilesFresh,
  locateProfileCard,
  waitForMassMessagingDone,
} = require('./helpers/dist-flow');

const DM_TIMEOUT = Number(process.env.E2E_DM_TIMEOUT_MS || 900000);

test.describe('Mass DM only — dist', () => {
  test.setTimeout(DM_TIMEOUT + 120000);

  test.beforeAll(() => {
    assertDistExists();
  });

  test('1 сообщение только лайкнутому профилю', async ({ page, request }) => {
    const token = await login(page);
    expect(token).toBeTruthy();

    await requireSenderAccount(request, token);

    const { target, control } = await prepareMassDmTargets(request, token);
    console.log(`Target: ${target.name} (@${target.username || '?'}) — ${target.url}`);
    if (control) {
      console.log(`Control: ${control.name} (@${control.username || '?'}) — ${control.url}`);
    }

    await setDmLimit(request, token, 1);

    await gotoProfilesFresh(page);
    await page.locator('select.select-input').first().selectOption('like');
    await page.waitForTimeout(500);

    const massBtn = page.locator('button').filter({ hasText: /Массовая рассылка|Mass/i });
    await expect(massBtn).toBeVisible();
    console.log('Step: запуск массовой рассылки из UI');
    await massBtn.click();

    const massStatus = await waitForMassMessagingDone(request, token, DM_TIMEOUT);
    expect(massStatus.running).toBeFalsy();

    const finalProfiles = await getProfiles(request, token);
    const targetRow = finalProfiles.find((p) => p.url === target.url);
    const controlRow = control ? finalProfiles.find((p) => p.url === control.url) : null;

    console.log(`Result target dmSent=${targetRow?.dmSent}, control dmSent=${controlRow?.dmSent ?? 'n/a'}`);

    expect(targetRow?.dmSent).toBe(1);
    if (controlRow) {
      expect(controlRow.dmSent || 0).toBe(0);
    }

    const sentAmongLiked = finalProfiles.filter(
      (p) => p.dmSent === 1 && p.url === target.url
    );
    expect(sentAmongLiked.length).toBe(1);

    await gotoProfilesFresh(page);
    await page.locator('select.select-input').first().selectOption('like');
    const targetCard = await locateProfileCard(page, target);
    await expect(targetCard.locator('.badge.dmTag, .badge:has-text("Написал")')).toBeVisible({
      timeout: 30000,
    });

    if (control) {
      await page.locator('select.select-input').first().selectOption('dislike');
      const controlCard = await locateProfileCard(page, control);
      await expect(controlCard.locator('.badge.dmTag, .badge:has-text("Написал")')).toHaveCount(0);
    }

    console.log('Mass DM dist test passed');
  });
});
