const https = require('https');
const http = require('http');

/**
 * Этот скрипт демонстрирует, как получать токен Dolphin Anty с вашего сервера (порт 5000),
 * вместо того чтобы хардкодить его в коде.
 */

// Вы должны подставить сюда JWT токен вашего бота (полученный после логина)
// Для тестов можно временно отключить проверку в auth-middleware.js для этого эндпоинта
const BOT_AUTH_TOKEN = 'ВАШ_JWT_ТОКЕН_БОТА';

async function getDolphinTokenFromServer() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/settings',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${BOT_AUTH_TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const settings = JSON.parse(data);
            resolve(settings.dolphinToken);
          } catch (e) {
            reject(new Error('Failed to parse settings JSON'));
          }
        } else {
          reject(new Error(`Server error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function fetchDolphinProfiles() {
  try {
    console.log('Fetching Dolphin token from local server...');
    const token = await getDolphinTokenFromServer();

    if (!token) {
      console.error('Dolphin token not found in database. Please set it in Settings -> Dolphin.');
      return;
    }

    console.log('Token fetched successfully. Requesting profiles from anty-api.com...');

    const options = {
      hostname: 'anty-api.com',
      path: '/browser_profiles?limit=50',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          console.log(`Successfully fetched ${json.data?.length || 0} profiles`);
          console.log(JSON.stringify(json, null, 2));
        } else {
          console.error(`Dolphin API Error: ${res.statusCode}`, data);
        }
      });
    });

    req.on('error', (e) => {
      console.error(`Request Error: ${e.message}`);
    });

    req.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fetchDolphinProfiles();
