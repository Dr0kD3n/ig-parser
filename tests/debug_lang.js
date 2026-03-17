const { createBrowserContext } = require('../backend/lib/browser');
const { getAllAccounts } = require('../backend/lib/config');
const path = require('path');

async function debug() {
  console.log('🚀 Starting Debug Session...');

  // Get the first account to replicate real conditions
  const accounts = await getAllAccounts('index');
  const config = accounts[0] || { locale: 'ru-RU' };

  console.log(
    'Profile config:',
    JSON.stringify({
      locale: config.locale,
      proxy: config.proxy ? config.proxy.server : 'None',
    })
  );

  const { browser, context } = await createBrowserContext(config, true);
  const page = await context.newPage();

  console.log('Navigating to Instagram...');
  try {
    await page.goto('https://www.instagram.com', { waitUntil: 'networkidle' });

    const info = await page.evaluate(() => {
      return {
        language: navigator.language,
        languages: navigator.languages,
        userAgent: navigator.userAgent,
        htmlLang: document.documentElement.lang,
      };
    });

    console.log('Browser Info:', info);

    const screenshotPath = path.join(__dirname, 'debug_lang.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);
  } catch (e) {
    console.error('Error during navigation:', e);
  } finally {
    await browser.close();
  }
}

debug().catch(console.error);
