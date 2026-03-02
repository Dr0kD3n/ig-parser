const { createBrowserContext } = require('../backend/lib/browser');
const path = require('path');
const fs = require('fs');

async function verify() {
    console.log('🚀 Starting anti-detect verification...');

    const config = {
        id: 'test-profile',
        fingerprint: {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            hardware: { cpuCores: 8, memoryGB: 16 },
            webgl: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }
        }
    };

    let browser;
    let context;

    try {
        const result = await createBrowserContext(config, false); // Headless: false to see what's happening
        browser = result.browser;
        context = result.context;

        const page = await context.newPage();

        console.log('📡 Navigating to bot.sannysoft.com...');
        await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle' });

        // Take a screenshot for manual review
        const screenshotPath = path.join(__dirname, 'antidetect_result.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved to: ${screenshotPath}`);

        // Extract some results
        const results = await page.evaluate(() => {
            const getResult = (id) => {
                const el = document.getElementById(id);
                return el ? el.innerText : 'Not found';
            };
            return {
                userAgent: getResult('user-agent'),
                webdriver: getResult('webdriver'),
                chrome: getResult('chrome'),
                permissions: getResult('permissions'),
                plugins: getResult('plugins'),
                languages: getResult('languages'),
                webgl_vendor: getResult('webgl-vendor'),
                webgl_renderer: getResult('webgl-renderer')
            };
        });

        console.log('📊 Analysis Results:', JSON.stringify(results, null, 2));

        // Check for common failures
        if (results.webdriver.toLowerCase().includes('fail')) {
            console.error('❌ WebDriver test FAILED');
        } else {
            console.log('✅ WebDriver test PASSED');
        }

        console.log('🔍 Waiting 10 seconds before closing...');
        await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
        console.error('❌ Verification failed:', error);
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
}

verify();
