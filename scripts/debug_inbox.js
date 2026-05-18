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
    const account = {
        id: row.id,
        name: row.name,
        proxy: null,
        cookies: [],
        fingerprint: row.fingerprint ? JSON.parse(row.fingerprint) : {},
        local_storage: row.local_storage
    };

    if (row.cookies) {
        const raw = decrypt(row.cookies);
        try { account.cookies = JSON.parse(raw); } catch (e) { }
    }

    const { browser, context } = await createBrowserContext(account, true); // Headless for this
    const page = await context.newPage();

    try {
        console.log("Navigating to Inbox...");
        await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded' });
        await wait(10000);

        const screenshotPath = path.join(process.cwd(), 'debug_inbox.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to ${screenshotPath}`);

        const htmlPath = path.join(process.cwd(), 'debug_inbox.html');
        await fs.writeFile(htmlPath, await page.content());
        console.log(`HTML saved to ${htmlPath}`);

        const items = await page.locator('[role="listitem"], [role="row"]').all();
        console.log(`Items found with [role="listitem"], [role="row"]: ${items.length}`);

    } finally {
        await browser.close();
    }
}

main();
