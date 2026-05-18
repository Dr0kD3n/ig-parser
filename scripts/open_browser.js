'use strict';
const { getDB } = require('../backend/lib/db');
const { createBrowserContext } = require('../backend/lib/browser');
const { wait } = require('../backend/lib/utils');
const { decrypt } = require('../backend/lib/encryption');

async function main() {
    const db = await getDB();
    const row = await db.get("SELECT * FROM accounts WHERE name = 'Основа'");
    if (!row) {
        console.error("Account 'Основа' not found.");
        return;
    }

    const account = {
        id: row.id,
        name: row.name,
        cookies: JSON.parse(decrypt(row.cookies)),
        fingerprint: row.fingerprint ? JSON.parse(row.fingerprint) : {},
        local_storage: row.local_storage
    };

    console.log(`🌐 Opening headful browser for: ${account.name}`);
    console.log(`⚠️ Please perform your actions. I will stay connected.`);

    // Use headful: true (the browser library usually takes this as second arg)
    const { browser, context } = await createBrowserContext(account, false, { headless: false });
    const page = await context.newPage();

    await page.goto('https://www.instagram.com/direct/inbox/', { timeout: 60000 });

    // Keep alive until browser closed
    browser.on('disconnected', () => {
        console.log("Browser closed. Exiting.");
        process.exit(0);
    });

    // Simple monitoring of URL changes to "follow"
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) {
            console.log(`📍 User navigated to: ${page.url()}`);
        }
    });

    console.log("🚀 Browser is ready and visible on your screen.");
}

main().catch(console.error);
