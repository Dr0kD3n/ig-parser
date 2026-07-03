const http = require('http');
const https = require('https');
const config = require('../lib/config');
const utils = require('../lib/utils');
const ctx = require('../lib/server-context');
module.exports = (app) => {
  const { CONFIG } = ctx;
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl || typeof imageUrl !== 'string')
    return res.status(400).send('Missing or invalid url parameter');
  try {
    const proxy = await config.getProxy('donors');
    const parsedUrl = new URL(imageUrl);
    const transport = parsedUrl.protocol === 'https:' ? https_1 : http_1;
    const fetchOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': CONFIG.userAgent,
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://www.instagram.com/',
      },
    };
    async function fetchWithRetry(url, options, transport, retries = 3) {
      for (let i = 0; i < retries; i++) {
        try {
          return await new Promise((resolve, reject) => {
            const proxyReq = transport.request(options, (res) => {
              resolve(res);
            });
            proxyReq.on('error', (e) => {
              if (i === retries - 1) reject(e);
              else reject(e); // Will be caught by catch block
            });
            proxyReq.setTimeout(30000, () => {
              proxyReq.destroy();
              reject(new Error('Timeout'));
            });
            proxyReq.end();
          });
        } catch (e) {
          console.warn(`[IMAGE PROXY] Fetch attempt ${i + 1} failed: ${e.message}`);
          if (i === retries - 1) throw e;
          await utils.wait(1000 * (i + 1));
        }
      }
    }
    // If proxy is configured, route through it via HTTP CONNECT
    if (proxy) {
      const proxyUrl = new URL(proxy.server);
      const authHeader =
        'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      // For HTTPS targets, use HTTP CONNECT tunnel
      if (parsedUrl.protocol === 'https:') {
        const connectReq = http.request({
          host: proxyUrl.hostname,
          port: proxyUrl.port || 80,
          method: 'CONNECT',
          path: `${parsedUrl.hostname}:443`,
          headers: { 'Proxy-Authorization': authHeader },
        });
        connectReq.setTimeout(15000, () => {
          connectReq.destroy();
        });
        connectReq.on('connect', async (_res, socket) => {
          if (_res.statusCode !== 200) {
            return res.status(502).send('Proxy CONNECT failed');
          }
          const connector = parsedUrl.protocol === 'https:' ? https_1 : http_1;
          const proxyReqOptions = {
            ...fetchOptions,
            socket: socket,
            agent: false,
          };
          try {
            const imgRes = await fetchWithRetry(imageUrl, proxyReqOptions, connector);
            handleImageResponse(imgRes);
          } catch (e) {
            console.error('Proxy HTTPS request error after retries:', e);
            res.status(502).send('Proxy HTTPS image fetch error');
          }
        });
        connectReq.on('error', () => res.status(502).send('Proxy connect error'));
        connectReq.end();
      } else {
        // For HTTP targets, use standard HTTP request
        const proxyReqOptions = {
          hostname: proxyUrl.hostname,
          port: proxyUrl.port || 80,
          path: imageUrl,
          headers: {
            ...fetchOptions.headers,
            'Proxy-Authorization': authHeader,
            Host: parsedUrl.hostname,
          },
        };
        try {
          const imgRes = await fetchWithRetry(imageUrl, proxyReqOptions, http_1);
          handleImageResponse(imgRes);
        } catch (e) {
          console.error('Proxy HTTP error after retries:', e);
          res.status(502).send('Proxy HTTP error');
        }
      }
    } else {
      // No proxy — direct fetch
      try {
        const imgRes = await fetchWithRetry(imageUrl, fetchOptions, transport);
        handleImageResponse(imgRes);
      } catch (e) {
        console.error('Direct fetch error after retries:', e);
        res.status(502).send('Direct image fetch error: ' + e.message);
      }
    }
    function handleImageResponse(imgRes) {
      // Follow redirects (Instagram CDN does 301/302)
      if ([301, 302, 307, 308].includes(imgRes.statusCode) && imgRes.headers.location) {
        // Redirect — fetch again without proxy (CDN URLs are public)
        const redirectTransport = imgRes.headers.location.startsWith('https') ? https_1 : http_1;
        redirectTransport
          .get(imgRes.headers.location, (redirRes) => {
            res.setHeader('Content-Type', redirRes.headers['content-type'] || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            redirRes.pipe(res);
          })
          .on('error', () => res.status(502).send('Redirect fetch error'));
        return;
      }
      if (imgRes.statusCode !== 200) {
        return res.status(imgRes.statusCode || 502).send('Image not available');
      }
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      imgRes.pipe(res);
    }
  } catch (e) {
    console.error('Image proxy error:', e);
    res.status(500).send('Internal server error');
  }
});

// --- Presets API ---
};
