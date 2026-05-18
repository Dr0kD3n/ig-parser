'use strict';
const { getDB } = require('../backend/lib/db');
const { createBrowserContext } = require('../backend/lib/browser');
const { wait } = require('../backend/lib/utils');
const { decrypt } = require('../backend/lib/encryption');
const fs = require('fs/promises');
const path = require('path');

async function main() {
    const db = await getDB();
    const row = await db.get("SELECT * FROM accounts WHERE name = 'Основа'");
    const account = { id: row.id, cookies: JSON.parse(decrypt(row.cookies)) };

    const { browser, context } = await createBrowserContext(account, false, { headless: false });
    const page = await context.newPage();

    console.log("🌐 Browser opened (headful). Monitoring chat selection...");
    await page.goto('https://www.instagram.com/direct/inbox/');

    page.on('framenavigated', async frame => {
        if (frame === page.mainFrame() && page.url().includes('/direct/t/')) {
            console.log(`📍 Detected Chat: ${page.url()}`);
            await wait(4000); // wait for content

            // Analyze the structure of the active chat
            const data = await page.evaluate(() => {
                const main = document.querySelector('section main section') || document.querySelector('div[role="main"]') || document.body;
                const items = Array.from(main.querySelectorAll('div, span, p'));
                // Filter for likely message bubbles
                const bundles = items.filter(el => {
                    const txt = el.innerText.trim();
                    return txt.length > 0 && txt.length < 500 && (el.getAttribute('dir') === 'auto' || el.className.includes('x'));
                }).map(el => ({
                    text: el.innerText.trim(),
                    tag: el.tagName,
                    class: el.className,
                    rect: el.getBoundingClientRect()
                }));
                return bundles;
            });

            await fs.writeFile(path.join(process.cwd(), 'tmp', 'chat_structure.json'), JSON.stringify({ url: page.url(), items: data }, null, 2));
            console.log("📝 Chat structure saved to tmp/chat_structure.json");
            await page.screenshot({ path: path.join(process.cwd(), 'tmp', 'chat_view.png') });
            console.log("📸 Screenshot saved to tmp/chat_view.png");
        }
    });

    browser.on('disconnected', () => process.exit(0));
}

main().catch(console.error);
