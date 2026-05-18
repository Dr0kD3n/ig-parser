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
    const exportDir = path.join(process.cwd(), 'export-data');
    await fs.mkdir(exportDir, { recursive: true });

    console.log(`🚀 HYPER-SPEED PARALLEL (3 TABS): ${row.name}`);
    const { browser, context } = await createBrowserContext(account, false, { headless: false });

    const pages = [await context.newPage(), await context.newPage(), await context.newPage()];
    for (const p of pages) {
        p.setDefaultTimeout(10000);
        await p.goto('https://www.instagram.com/direct/inbox/');
    }

    const processed = new Set();
    const chatQueue = [];

    // Worker logic
    async function worker(page, id) {
        while (true) {
            // Refresh queue if empty
            if (chatQueue.length === 0) {
                const names = await page.evaluate(() => {
                    const sidebar = document.querySelector('div.xb57i2i, [role="navigation"]');
                    return Array.from(sidebar?.querySelectorAll('div[role="button"]') || [])
                        .map(el => el.innerText.split('\n')[0].trim())
                        .filter(n => n.length > 2 && !['Search', 'Primary', 'General', 'Notes', 'Active'].some(k => n.startsWith(k)));
                });
                names.forEach(n => { if (!processed.has(n)) chatQueue.push(n); });

                if (chatQueue.length === 0) {
                    // Scroll if still no new
                    await page.evaluate(() => document.querySelector('div.xb57i2i')?.scrollBy(0, 4000));
                    await wait(800); // Only idle for sidebar fetch 
                    continue;
                }
            }

            const name = chatQueue.shift();
            if (!name || processed.has(name)) continue;
            processed.add(name);

            try {
                console.log(`[Tab ${id}] 🚀 ${name}`);
                await page.click(`div[role="button"]:has-text("${name}")`, { force: true, noWaitAfter: true });
                await wait(600); // 40ms is too fast for network, 600ms is minimum render 

                // History burst
                for (let h = 0; h < 12; h++) {
                    await page.mouse.move(800, 500);
                    await page.mouse.wheel(0, -9000);
                    await wait(60); // 40ms target for scroll increments
                    if (h % 4 === 0 && await page.evaluate(() => !!document.querySelector('img[style*="border-radius: 50%"][width="96"]'))) break;
                }

                const msgs = await page.evaluate((n) => {
                    const found = [];
                    const items = Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"], [role="row"]'));
                    items.forEach(el => {
                        const rect = el.getBoundingClientRect();
                        if (rect.left < 330) return;
                        const t = el.innerText.trim();
                        if (!t || t === n) return;
                        const isMe = rect.left > 600 || window.getComputedStyle(el).backgroundColor.includes('0, 149, 246');
                        found.push({ s: isMe ? 'Me' : n, t });
                    });
                    return found.filter((v, i, a) => a.findIndex(t => t.t === v.t) === i);
                }, name);

                const file = path.join(exportDir, `${name.replace(/[^a-z0-9а-яё]/gi, '_').substring(0, 40)}.json`);
                await fs.writeFile(file, JSON.stringify(msgs, null, 2));
                console.log(`[Tab ${id}] ✅ ${msgs.length} msgs`);

                await wait(40); // User requested 40ms stall
            } catch (err) {
                console.log(`[Tab ${id}] ERR: ${err.message}`);
            }
        }
    }

    // Launch all workers
    await Promise.all([worker(pages[0], 0), worker(pages[1], 1), worker(pages[2], 2)]);
    await browser.close().catch(() => { });
}
main();
