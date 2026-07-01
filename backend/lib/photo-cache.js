const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const path = require('path');
const { getRootPath } = require('./utils');

const PHOTO_DIR = path.join(getRootPath(), 'config', 'profile-photos');
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function normalizePhotoUrl(photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') return '';
  try {
    return new URL(photoUrl).toString();
  } catch (e) {
    return '';
  }
}

function getPhotoHash(photoUrl) {
  return crypto.createHash('sha256').update(photoUrl).digest('hex');
}

function getExtension(contentType) {
  const cleanType = String(contentType || '').split(';')[0].trim().toLowerCase();
  return EXT_BY_TYPE[cleanType] || 'jpg';
}

function getPublicPhotoPath(fileName) {
  return `/profile-photos/${fileName}`;
}

function getLocalPhotoPath(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return null;
  const fileName = path.basename(publicPath);
  if (!/^[a-f0-9]{64}\.(jpg|jpeg|png|webp|gif)$/i.test(fileName)) return null;
  return path.join(PHOTO_DIR, fileName);
}

async function findCachedPhoto(photoUrl) {
  const normalizedUrl = normalizePhotoUrl(photoUrl);
  if (!normalizedUrl) return null;

  const hash = getPhotoHash(normalizedUrl);
  for (const ext of Object.values(EXT_BY_TYPE)) {
    const fileName = `${hash}.${ext}`;
    const filePath = path.join(PHOTO_DIR, fileName);
    if (fs.existsSync(filePath)) {
      return getPublicPhotoPath(fileName);
    }
  }

  return null;
}

async function cacheProfilePhoto(photoUrl) {
  const normalizedUrl = normalizePhotoUrl(photoUrl);
  if (!normalizedUrl) {
    return { success: false, status: 'missing', error: 'Empty photo url' };
  }

  const cached = await findCachedPhoto(normalizedUrl);
  if (cached) {
    return { success: true, status: 'cached', localPath: cached, cachedAt: new Date().toISOString() };
  }

  await fsp.mkdir(PHOTO_DIR, { recursive: true });

  return new Promise((resolve) => {
    const parsedUrl = new URL(normalizedUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.get(
      normalizedUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://www.instagram.com/',
        },
      },
      async (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const redirected = new URL(res.headers.location, normalizedUrl).toString();
          resolve(cacheProfilePhoto(redirected));
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          resolve({ success: false, status: 'failed', error: `HTTP ${res.statusCode}` });
          return;
        }

        const contentType = String(res.headers['content-type'] || '');
        if (!contentType.toLowerCase().startsWith('image/')) {
          res.resume();
          resolve({ success: false, status: 'failed', error: 'Response is not an image' });
          return;
        }

        const contentLength = Number(res.headers['content-length'] || 0);
        if (contentLength > MAX_PHOTO_BYTES) {
          res.resume();
          resolve({ success: false, status: 'failed', error: 'Image is too large' });
          return;
        }

        const fileName = `${getPhotoHash(normalizedUrl)}.${getExtension(contentType)}`;
        const filePath = path.join(PHOTO_DIR, fileName);
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        const file = fs.createWriteStream(tmpPath);
        let received = 0;
        let settled = false;

        const fail = async (error) => {
          if (settled) return;
          settled = true;
          res.destroy();
          file.destroy();
          await fsp.unlink(tmpPath).catch(() => {});
          resolve({ success: false, status: 'failed', error: error.message || String(error) });
        };

        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_PHOTO_BYTES) {
            fail(new Error('Image is too large'));
          }
        });

        file.on('error', fail);
        res.on('error', fail);
        file.on('finish', async () => {
          if (settled) return;
          settled = true;
          await fsp.rename(tmpPath, filePath);
          resolve({
            success: true,
            status: 'cached',
            localPath: getPublicPhotoPath(fileName),
            cachedAt: new Date().toISOString(),
          });
        });

        res.pipe(file);
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Photo download timeout'));
    });
    req.on('error', (error) => {
      resolve({ success: false, status: 'failed', error: error.message });
    });
  });
}

async function savePhotoBuffer(photoUrl, buffer, contentType) {
  const normalizedUrl = normalizePhotoUrl(photoUrl);
  if (!normalizedUrl) {
    return { success: false, status: 'missing', error: 'Empty photo url' };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { success: false, status: 'failed', error: 'Empty image buffer' };
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    return { success: false, status: 'failed', error: 'Image is too large' };
  }
  if (!String(contentType || '').toLowerCase().startsWith('image/')) {
    return { success: false, status: 'failed', error: 'Response is not an image' };
  }

  await fsp.mkdir(PHOTO_DIR, { recursive: true });

  const fileName = `${getPhotoHash(normalizedUrl)}.${getExtension(contentType)}`;
  const filePath = path.join(PHOTO_DIR, fileName);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, buffer);
  await fsp.rename(tmpPath, filePath);

  return {
    success: true,
    status: 'cached',
    localPath: getPublicPhotoPath(fileName),
    cachedAt: new Date().toISOString(),
  };
}

async function cacheProfilePhotoFromPage(page, photoUrl) {
  const normalizedUrl = normalizePhotoUrl(photoUrl);
  if (!normalizedUrl) {
    return { success: false, status: 'missing', error: 'Empty photo url' };
  }

  const cached = await findCachedPhoto(normalizedUrl);
  if (cached) {
    return { success: true, status: 'cached', localPath: cached, cachedAt: new Date().toISOString() };
  }

  if (page.request) {
    try {
      const res = await page.request.get(normalizedUrl, {
        headers: {
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://www.instagram.com/',
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      if (!res.ok()) {
        return { success: false, status: 'failed', error: `HTTP ${res.status()}` };
      }

      const contentType = res.headers()['content-type'] || '';
      if (!contentType.toLowerCase().startsWith('image/')) {
        return { success: false, status: 'failed', error: 'Response is not an image' };
      }

      const buffer = await res.body();
      return savePhotoBuffer(normalizedUrl, buffer, contentType);
    } catch (e) {
      // Если request API не смог скачать CDN-ссылку, пробуем старый способ из DOM-контекста.
    }
  }

  const result = await page.evaluate(
    async ({ url, maxBytes }) => {
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      if (!res.ok) {
        return { success: false, status: 'failed', error: `HTTP ${res.status}` };
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('image/')) {
        return { success: false, status: 'failed', error: 'Response is not an image' };
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        return { success: false, status: 'failed', error: 'Image is too large' };
      }

      const bytes = Array.from(new Uint8Array(buffer));
      return { success: true, contentType, bytes };
    },
    { url: normalizedUrl, maxBytes: MAX_PHOTO_BYTES }
  );

  if (!result.success) return result;
  return savePhotoBuffer(normalizedUrl, Buffer.from(result.bytes), result.contentType);
}

module.exports = {
  PHOTO_DIR,
  cacheProfilePhoto,
  cacheProfilePhotoFromPage,
  findCachedPhoto,
  getLocalPhotoPath,
};
