const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function diagnose() {
    console.log('=== Playwright Diagnostics ===');
    console.log('Node version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Arch:', process.arch);

    try {
        const pwPath = require.resolve('playwright');
        console.log('Playwright path:', pwPath);
        const pkg = require('playwright/package.json');
        console.log('Playwright version:', pkg.version);
    } catch (e) {
        console.error('❌ Playwright not found in node_modules');
    }

    console.log('\nChecking browsers...');
    const installResult = spawnSync('npx', ['playwright', 'install', '--inspect'], { encoding: 'utf8' });
    const stdout = installResult.stdout || '';
    console.log('Discovery info:', stdout.split('\n').filter(l => l.includes('Chromium')).join('\n') || 'No info');

    console.log('\nAttempting to launch browser...');
    try {
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('✅ Browser launched successfully!');
        const version = browser.version();
        console.log('Browser version:', version);
        await browser.close();
    } catch (e) {
        console.error('❌ FAILED to launch browser!');
        console.error('Error message:', e.message);

        if (e.message.includes('Executable doesn\'t exist')) {
            console.log('\n💡 SUGGESTION: Run "npx playwright install chromium"');
        } else if (process.platform === 'linux') {
            console.log('\n💡 SUGGESTION: You might be missing system libraries. Run "npx playwright install-deps"');
        }

        if (e.stack && e.stack.includes('mcpBundle')) {
            console.log('\n💡 BUG DETECTED: Playwright MCP bundle crash. Running patch...');
            const patchPath = path.join(__dirname, '..', 'backend', 'scripts', 'patch-playwright-mcp.js');
            if (fs.existsSync(patchPath)) {
                spawnSync('node', [patchPath], { stdio: 'inherit' });
                console.log('Patch applied. Please try running again.');
            }
        }
    }
}

diagnose();
