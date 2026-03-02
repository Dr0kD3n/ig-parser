const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testInjection() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // Define the injection logic similar to authorizer.js
    await context.addInitScript(() => {
        if (window.self !== window.top) return;
        const injectButton = () => {
            if (document.getElementById('save-session-btn')) return;
            const btn = document.createElement('button');
            btn.innerHTML = 'СОХРАНИТЬ СЕССИЮ';
            btn.id = 'save-session-btn';
            btn.style = "position:fixed;bottom:20px;right:20px;z-index:9999;padding:15px 25px;background:#0095f6;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;";
            document.body.appendChild(btn);
        };
        setInterval(injectButton, 500);
    });

    const page = await context.newPage();

    // Create a simple page with an iframe
    const htmlSnippet = `
        <html>
            <body>
                <h1>Main Page</h1>
                <iframe id="test-frame" srcdoc="<html><body><h2>Iframe Content</h2></body></html>"></iframe>
            </body>
        </html>
    `;

    await page.setContent(htmlSnippet);
    await page.waitForTimeout(2000); // Wait for injection

    const mainButtonCount = await page.evaluate(() => {
        return document.querySelectorAll('#save-session-btn').length;
    });

    const frameButtonCount = await page.evaluate(() => {
        const frame = document.getElementById('test-frame');
        return frame.contentWindow.document.querySelectorAll('#save-session-btn').length;
    });

    console.log(`Main Page Button Count: ${mainButtonCount}`);
    console.log(`Iframe Button Count: ${frameButtonCount}`);

    if (mainButtonCount === 1 && frameButtonCount === 0) {
        console.log('✅ Verification Successful: Button only on top level.');
    } else {
        console.error('❌ Verification Failed: Button detected in iframe or missing on top level.');
        process.exit(1);
    }

    await browser.close();
}

testInjection().catch(err => {
    console.error(err);
    process.exit(1);
});
