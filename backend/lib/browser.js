'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const playwright_extra_1 = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path_1 = require('path');
const utils_1 = require('./utils');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const http = require('http');

const { BrowserError, NetworkError } = require('./errors');
const { handleError } = require('./error-handler');
const { getDB } = require('./db');

const fingerprintGenerator = new FingerprintGenerator();
const fingerprintInjector = new FingerprintInjector();

playwright_extra_1.chromium.use(stealth);

async function createBrowserContext(config, headless = false) {
  const defaultViewport = { width: 1280, height: 720 };
  const viewport =
    (config.fingerprint && config.fingerprint.viewport) || config.viewport || defaultViewport;
  const userAgent = (config.fingerprint && config.fingerprint.userAgent) || config.userAgent;
  const locale = 'en-US';

  const contextOptions = {
    viewport,
    userAgent,
    locale,
    colorScheme: config.colorScheme || 'dark',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  };

  const geoMap = {
    RU: { tz: 'Europe/Moscow', loc: { latitude: 55.7558, longitude: 37.6173 } },
    FR: { tz: 'Europe/Paris', loc: { latitude: 48.8566, longitude: 2.3522 } },
    DE: { tz: 'Europe/Berlin', loc: { latitude: 52.52, longitude: 13.405 } },
    ES: { tz: 'Europe/Madrid', loc: { latitude: 40.4168, longitude: -3.7038 } },
    US: { tz: 'America/New_York', loc: { latitude: 40.7128, longitude: -74.006 } },
    GB: { tz: 'Europe/London', loc: { latitude: 51.5074, longitude: -0.1278 } },
  };

  if (config.countryCode && geoMap[config.countryCode]) {
    contextOptions.timezoneId = geoMap[config.countryCode].tz;
    contextOptions.geolocation = geoMap[config.countryCode].loc;
    contextOptions.permissions = ['geolocation'];
  }

  if (config.proxy) {
    contextOptions.proxy = {
      server: config.proxy.server,
      username: config.proxy.username,
      password: config.proxy.password,
    };
  }

  let browser;
  let context;

  // Dolphin Anty Integration
  let dolphinToken = config.fingerprint?.dolphinToken;
  const dolphinProfileId = config.fingerprint?.dolphinProfileId;

  if (!dolphinToken && dolphinProfileId) {
    try {
      const db = await getDB();
      const row = await db.get(`SELECT value FROM settings WHERE key = 'dolphinToken'`);
      if (row?.value) {
        dolphinToken = row.value;
      }
    } catch (e) {
      console.error('Error fetching global dolphin token:', e);
    }
  }

  let dolphinSuccess = false;
  if (dolphinToken && dolphinProfileId) {
    try {
      console.log(`🐬 [DOLPHIN] Launching profile: ${dolphinProfileId}`);
      const launchUrl = `http://127.0.0.1:3001/v1.0/browser_profiles/${dolphinProfileId}/start?automation=1`;

      const response = await new Promise((resolve, reject) => {
        const req = http
          .get(launchUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
              } catch (e) {
                resolve({ statusCode: res.statusCode, data: null });
              }
            });
          })
          .on('error', reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      }).catch((e) => ({ statusCode: 500, error: e.message }));

      // Проверка для локального API: игнорируем HTTP 503, если websocket получен (Dolphin может возвращать 503 при проблемах с облаком)
      if (response.data && response.data.automation && response.data.automation.wsEndpoint) {
        browser = await playwright_extra_1.chromium.connectOverCDP(
          response.data.automation.wsEndpoint
        );
        context = browser.contexts()[0];
        dolphinSuccess = true;
      } else {
        const msg =
          response.data?.message ||
          response.data?.error ||
          response.error ||
          `HTTP ${response.statusCode}`;
        handleError(new NetworkError(`[DOLPHIN] ${msg}`, { profileId: dolphinProfileId }));
        console.warn(`⚠️ [DOLPHIN] Falling back to local browser.`);
      }
    } catch (e) {
      handleError(
        new NetworkError(`[DOLPHIN] Connection error: ${e.message}`, {
          profileId: dolphinProfileId,
        })
      );
      console.warn(`⚠️ [DOLPHIN] Falling back to local browser.`);
    }
  }

  try {
    if (!dolphinSuccess) {
      if (config.id) {
        const userDataDir = path_1.join((0, utils_1.getRootPath)(), 'data', 'profiles', config.id);
        context = await playwright_extra_1.chromium.launchPersistentContext(userDataDir, {
          headless,
          ...contextOptions,
          channel: 'chrome-beta',
          args: [
            '--lang=en-US',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-web-security',
            `--window-size=${viewport.width},${viewport.height}`,
          ],
          ignoreDefaultArgs: ['--enable-automation'],
        });
        browser = context.browser();
      } else {
        browser = await playwright_extra_1.chromium.launch({
          headless,
          channel: 'chrome-beta',
          args: [
            '--disable-blink-features=AutomationControlled',
            `--window-size=${viewport.width},${viewport.height}`,
          ],
          ignoreDefaultArgs: ['--enable-automation'],
        });
        context = await browser.newContext(contextOptions);
      }
    }
  } catch (e) {
    throw new BrowserError(`Failed to launch browser: ${e.message}`, { configId: config.id });
  }

  await applyFingerprint(context, config.fingerprint);
  if (config.cookies) await context.addCookies(config.cookies).catch(() => {});
  if (config.local_storage) {
    await context.addInitScript((ls) => {
      try {
        const data = JSON.parse(ls);
        for (const key in data) {
          window.localStorage.setItem(key, data[key]);
        }
      } catch (e) {}
    }, config.local_storage);
  }

  // Inject hardcore Canvas, Audio, and UI noise uniquely bound to account ID
  const seed = config.id
    ? config.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    : Math.floor(Math.random() * 1000);
  await context.addInitScript((seedValue) => {
    const noise = ((Math.sin(seedValue) * 10000) % 1) * 0.00001;

    // 1. AudioContext Noise
    const originalGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (channel) {
      const results = originalGetChannelData.apply(this, arguments);
      for (let i = 0; i < results.length; i += 100) {
        results[i] += noise;
      }
      return results;
    };

    // 2. Canvas Noise
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      const imageData = originalGetImageData.apply(this, arguments);
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i] < 255) {
          imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(noise * 1000000));
        }
      }
      return imageData;
    };

    // 3. DOMRect / ClientRect Noise
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    // @ts-ignore
    Element.prototype.getBoundingClientRect = function () {
      const rect = originalGetBoundingClientRect.apply(this, arguments);
      const r = {
        x: rect.x + noise,
        y: rect.y + noise,
        width: rect.width + noise,
        height: rect.height + noise,
        top: rect.top + noise,
        right: rect.right + noise,
        bottom: rect.bottom + noise,
        left: rect.left + noise,
      };
      r.toJSON = () => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
      });
      // @ts-ignore
      return r;
    };
    const originalGetClientRects = Element.prototype.getClientRects;
    // @ts-ignore
    Element.prototype.getClientRects = function () {
      const rect = this.getBoundingClientRect();
      const rects = [rect];
      // @ts-ignore
      rects.item = function (index) {
        return this[index];
      };
      // @ts-ignore
      return rects;
    };
  }, seed);

  return { browser, context };
}

async function applyFingerprint(context, fingerprint) {
  if (!fingerprint) return;

  // Inject base fingerprint (User Agent, Canvas, etc.)
  if (fingerprint.fingerprint) {
    await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);
  }

  // Hardware Spoofing (CPU & Memory)
  if (fingerprint.hardware) {
    await context.addInitScript((hw) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => hw.cpuCores || 8 });
      if (hw.memoryGB) {
        // @ts-ignore
        navigator.deviceMemory = hw.memoryGB;
      }
    }, fingerprint.hardware);
  }

  // WebGL Spoofing
  if (fingerprint.webgl) {
    await context.addInitScript((gl) => {
      const getParameter = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, options) {
        const context = getParameter.apply(this, [type, options]);
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
          const originalGetParameter = context.getParameter;
          context.getParameter = function (param) {
            if (param === 37445) return gl.vendor; // UNMASKED_VENDOR_WEBGL
            if (param === 37446) return gl.renderer; // UNMASKED_RENDERER_WEBGL
            return originalGetParameter.apply(this, [param]);
          };
        }
        return context;
      };
    }, fingerprint.webgl);
  }

  // WebRTC Leak protection
  await context.addInitScript(() => {
    // @ts-ignore
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
      navigator.mediaDevices.enumerateDevices = async function () {
        const devices = await originalEnumerateDevices.apply(this);
        return devices.filter((d) => d.kind !== 'audioinput' && d.kind !== 'videoinput');
      };
    }
  });
}

function optimizeContextForScraping(context) {
  return context.route('**/*', (route) => {
    if (['image', 'media'].includes(route.request().resourceType())) route.abort();
    else route.continue();
  });
}

function startLiveView(context) {
  return setInterval(async () => {
    try {
      const pages = context.pages();
      if (pages.length > 0) {
        const liveViewPath = path_1.join(
          (0, utils_1.getRootPath)(),
          'data',
          'screenshots',
          'live_view.jpg'
        );
        await pages[pages.length - 1].screenshot({ path: liveViewPath, type: 'jpeg', quality: 30 });
      }
    } catch (e) {}
  }, 2000);
}

async function takeLiveScreenshot(page) {
  try {
    const liveViewPath = path_1.join(
      (0, utils_1.getRootPath)(),
      'data',
      'screenshots',
      'live_view.jpg'
    );
    await page.screenshot({ path: liveViewPath, type: 'jpeg', quality: 30 });
  } catch (e) {}
}

async function watchStory(page) {
  try {
    const storyAriaLabel = ['Смотреть историю', 'Watch story', 'Сториз', 'Story'];
    const storyBtn = page
      .locator('div[role="button"]')
      .filter({
        has: page.locator('canvas'),
      })
      .first();

    if ((await storyBtn.count()) > 0 && (await storyBtn.isVisible())) {
      await storyBtn.click();
      console.log(`👤 [HUMAN] Watching story...`);
      // Watch for 5-10 seconds
      await (0, utils_1.wait)(5000 + Math.random() * 5000);

      // Close story if still open
      const closeBtn = page.locator('svg[aria-label="Закрыть"], svg[aria-label="Close"]').first();
      if ((await closeBtn.count()) > 0) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await (0, utils_1.wait)(1000);
    }
  } catch (e) {
    console.warn(`⚠️ [HUMAN] Failed to watch story: ${e.message}`);
  }
}

async function checkLoginPage(page) {
  try {
    return await page.evaluate(() => {
      const loginMarkers = ['input[name="username"]', 'input[name="password"]', 'form#loginForm'];
      return loginMarkers.some((sel) => !!document.querySelector(sel));
    });
  } catch (e) {
    return false;
  }
}

exports.createBrowserContext = createBrowserContext;
exports.applyFingerprint = applyFingerprint;
exports.optimizeContextForScraping = optimizeContextForScraping;
exports.startLiveView = startLiveView;
exports.takeLiveScreenshot = takeLiveScreenshot;
exports.watchStory = watchStory;
exports.checkLoginPage = checkLoginPage;
