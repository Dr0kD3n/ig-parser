const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');

const JWT_SECRET = 'dev_secret_only_for_local_testing';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();

function decrypt(text) {
    if (!text || !text.includes(':')) return text;
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts.slice(1).join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

async function main() {
    const accountData = JSON.parse(fs.readFileSync('c:\\Users\\root\\Documents\\Projects\\ig\\ig-bot\\tmp\\osnova_cookies_utf8.json', 'utf8'));
    const decryptedCookies = JSON.parse(decrypt(accountData.cookies));

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    await context.addCookies(decryptedCookies);
    const page = await context.newPage();

    page.on('response', async response => {
        const url = response.url();
        if (url.includes('/api/v1/friendships/') && url.includes('/followers')) {
            try {
                const json = await response.json();
                if (json.users && json.users.length > 0) {
                    console.log('USER DATA EXAMPLE:', JSON.stringify(json.users[0], null, 2));
                }
            } catch (e) { }
        }
    });

    await page.goto('https://www.instagram.com/kseniyaa.alfyorovaa/followers/');
    await new Promise(r => setTimeout(r, 10000));
    await browser.close();
}

main().catch(console.error);
