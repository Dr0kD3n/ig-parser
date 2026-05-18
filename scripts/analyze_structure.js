'use strict';
const { getDB } = require('../backend/lib/db');
const { createBrowserContext } = require('../backend/lib/browser');
const { wait } = require('../backend/lib/utils');
const { decrypt } = require('../backend/lib/encryption');
const fs = require('fs/promises');

async function main() {
    const db = await getDB();
    const row = await db.get("SELECT * FROM accounts WHERE name = 'Основа'");
    const account = {
        id: row.id,
        name: row.name,
        cookies: [],
        fingerprint: row.fingerprint ? JSON.parse(row.fingerprint) : {},
        local_storage: row.local_storage
    };
    if (row.cookies) {
        const raw = decrypt(row.cookies);
        try { account.cookies = JSON.parse(raw); } catch (e) { }
    }

    const { browser, context } = await createBrowserContext(account, false);
    const page = await context.newPage();

    try {
        await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded' });
        await wait(15000); // Wait longer for SPA

        console.log("Analyzing page structure...");

        const data = await page.evaluate(() => {
            const results = [];
            // Find all elements that might be chat items
            const potential = document.querySelectorAll('div, a, span');
            potential.forEach(el => {
                const text = el.innerText.trim();
                if (text && text.length > 2 && text.length < 100) {
                    const role = el.getAttribute('role');
                    const href = el.getAttribute('href');
                    if (role || href || el.className.includes('x')) {
                        results.push({ tag: el.tagName, text, role, href, class: el.className });
                    }
                }
            });
            return results;
        });

        await fs.writeFile('structure_analysis.json', JSON.stringify(data, null, 2));
        console.log("Structure saved to structure_analysis.json");

    } finally {
        await browser.close();
    }
}

main();
