'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const https = require('https');
const path = require('path');
const { getDB } = require('./db');
const { getLocalPhotoPath } = require('./photo-cache');
const { encryptTelegramToken, decryptTelegramToken } = require('./telegram-credential-store');
const { telegramCommandExecutor } = require('./telegram-command-executor');
const { operationEvents } = require('./operation-events');

const POLL_TIMEOUT_SECONDS = 25;
const PAIR_TTL_MS = 5 * 60 * 1000;
const CONFIRM_TTL_MS = 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const WORKER_TYPES = new Set(['index', 'parser', 'checker']);
const PROFILE_CALLBACK_PATTERN = /^tgprofile:(\d+):(like|dislike)$/;

const PHOTO_CONTENT_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createMultipartBody(payload, file) {
  const boundary = `----IgBot${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${serialized}\r\n`
      )
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
    ),
    file.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function telegramRequest(token, method, payload = {}, options = {}) {
  let body;
  let contentType = 'application/json';
  if (options.file) {
    const multipart = createMultipartBody(payload, options.file);
    body = multipart.body;
    contentType = multipart.contentType;
  } else {
    body = Buffer.from(JSON.stringify(payload));
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
        timeout: options.timeoutMs || 15_000,
      },
      (response) => {
        let raw = '';
        let bytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Ответ Telegram API слишком большой'));
            return;
          }
          raw += chunk;
        });
        response.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw || '{}');
          } catch {
            return reject(
              new Error(`Telegram API вернул некорректный JSON (${response.statusCode})`)
            );
          }
          if (response.statusCode < 200 || response.statusCode >= 300 || data.ok !== true) {
            const error = new Error(data.description || `Telegram API HTTP ${response.statusCode}`);
            error.statusCode = response.statusCode;
            error.telegramCode = data.error_code;
            return reject(error);
          }
          resolve(data.result);
        });
      }
    );

    const abort = () => {
      const error = new Error('Telegram polling остановлен');
      error.code = 'ABORT_ERR';
      request.destroy(error);
    };
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    request.on('timeout', () => request.destroy(new Error('Telegram API timeout')));
    request.on('error', reject);
    request.on('close', () => options.signal?.removeEventListener('abort', abort));
    request.write(body);
    request.end();
  });
}

function delayWithSignal(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

function formatStatus(status) {
  const enabledWorkers = Object.entries(status.workers)
    .filter(([, running]) => running)
    .map(([name]) => name);
  const workerText = enabledWorkers.length ? enabledWorkers.join(', ') : 'нет';
  const massText = status.mass.running
    ? `${status.mass.status || 'работает'} ${status.mass.current}/${status.mass.total}`
    : 'остановлена';
  const scheduleText = status.schedule
    ? `#${status.schedule.id} ${status.schedule.title || ''} · ${status.schedule.startAt}`
    : 'нет активных слотов';
  return [
    'Статус локального сервиса',
    `Instagram workers: ${workerText}`,
    `Текущая активность: ${status.activity || 'нет'}`,
    `Рассылка: ${massText}`,
    `Следующий слот: ${scheduleText}`,
  ].join('\n');
}

function formatResult(command, result) {
  if (command === 'status.get') return formatStatus(result);
  if (command === 'mass.status') {
    return result.running
      ? `Рассылка: ${result.status || 'работает'} ${result.current || 0}/${result.total || 0}`
      : 'Рассылка остановлена.';
  }
  if (command === 'schedule.status') {
    return result.next
      ? `Следующий слот: #${result.next.id} ${result.next.title || ''}\n${result.next.startAt}`
      : 'Запланированных слотов нет.';
  }
  if (result?.success === false) return result.error || 'Команда не выполнена.';
  return result?.message || 'Команда выполнена.';
}

function parseCommand(text) {
  const [rawCommand, ...args] = String(text || '')
    .trim()
    .split(/\s+/);
  const command = rawCommand.toLowerCase().split('@')[0];
  switch (command) {
    case '/status':
      return { command: 'status.get', payload: {}, mutation: false };
    case '/mass_status':
      return { command: 'mass.status', payload: {}, mutation: false };
    case '/schedule':
      return { command: 'schedule.status', payload: {}, mutation: false };
    case '/worker_start':
      return {
        command: 'worker.start',
        payload: { type: String(args[0] || '').toLowerCase() },
        mutation: true,
      };
    case '/worker_stop':
      return {
        command: 'worker.stop',
        payload: { type: String(args[0] || '').toLowerCase() },
        mutation: true,
      };
    case '/mass_start':
      return { command: 'mass.start', payload: {}, mutation: true };
    case '/mass_stop':
      return { command: 'mass.stop', payload: {}, mutation: true };
    case '/skip_donor':
      return { command: 'donor.skip', payload: {}, mutation: true };
    default:
      return null;
  }
}

function commandLabel(command, payload) {
  const workerLabels = {
    index: 'фарм профилей',
    parser: 'фарм доноров',
    checker: 'проверку ответов',
  };
  const workerLabel = workerLabels[payload.type] || `worker ${payload.type}`;
  if (command === 'worker.start') return `Запустить ${workerLabel}`;
  if (command === 'worker.stop') return `Остановить ${workerLabel}`;
  if (command === 'mass.start') return 'Запустить массовую рассылку';
  if (command === 'mass.stop') return 'Остановить рассылку';
  if (command === 'donor.skip') return 'Пропустить текущего донора';
  return command;
}

function createTelegramBotService(dependencies = {}) {
  const getDatabase = dependencies.getDB || getDB;
  const request = dependencies.telegramRequest || telegramRequest;
  const executor = dependencies.commandExecutor || telegramCommandExecutor;
  const events = dependencies.operationEvents || operationEvents;
  const encryptToken = dependencies.encryptTelegramToken || encryptTelegramToken;
  const decryptToken = dependencies.decryptTelegramToken || decryptTelegramToken;
  const randomBytes = dependencies.randomBytes || crypto.randomBytes;
  const now = dependencies.now || (() => Date.now());

  let running = false;
  let connected = false;
  let currentToken = null;
  let botUsername = null;
  let loopPromise = null;
  let abortController = null;
  let lastError = null;
  let lastSuccessAt = null;
  let eventSubscribed = false;
  const confirmations = new Map();

  async function getConfig() {
    const database = await getDatabase();
    return database.get('SELECT * FROM telegram_bot_config WHERE id = 1');
  }

  async function getStoredToken(config) {
    if (!config?.token_ciphertext) return null;
    return decryptToken(config.token_ciphertext);
  }

  async function sendMessage(chatId, text, extra = {}) {
    if (!currentToken || !chatId) return null;
    return request(currentToken, 'sendMessage', {
      chat_id: chatId,
      text: String(text || '').slice(0, 4000),
      ...extra,
    });
  }

  async function sendPhoto(chatId, photo, caption, replyMarkup, file = null) {
    if (!currentToken || !chatId || !photo) return null;
    const payload = {
      chat_id: chatId,
      photo: file ? undefined : photo,
      caption: String(caption || '').slice(0, 1024),
      reply_markup: replyMarkup,
    };
    if (!file) return request(currentToken, 'sendPhoto', payload);
    return request(
      currentToken,
      'sendPhoto',
      { ...payload, photo: undefined },
      {
        file: {
          field: 'photo',
          filename: path.basename(file.path),
          contentType: PHOTO_CONTENT_TYPES[path.extname(file.path).toLowerCase()] || 'image/jpeg',
          buffer: file.buffer,
        },
      }
    );
  }

  function getProfileUsername(profile) {
    const fromField = String(profile?.username || '')
      .replace(/^@/, '')
      .trim();
    if (fromField) return fromField;
    const match = String(profile?.url || '').match(/instagram\.com\/([^/?#]+)/i);
    return match ? match[1] : '';
  }

  function buildProfileCard(profile) {
    const username = getProfileUsername(profile);
    const displayName = String(profile?.name || '').trim();
    const bio = String(profile?.bio || '').trim();
    const title = username ? `@${username}` : displayName || 'Профиль';
    const description = [displayName && displayName !== username ? displayName : '', bio]
      .filter(Boolean)
      .join('\n\n');
    const instagramUrl = username
      ? `https://www.instagram.com/${encodeURIComponent(username)}/`
      : profile.url;
    const telegramUrl = `https://t.me/${encodeURIComponent(username)}`;
    return {
      caption: [title, description].filter(Boolean).join('\n\n'),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: 'IG', url: instagramUrl },
            { text: 'TG', url: telegramUrl },
            { text: '❤️', callback_data: `tgprofile:${profile.telegram_id}:like` },
            { text: '✕', callback_data: `tgprofile:${profile.telegram_id}:dislike` },
          ],
          [{ text: '⚙️ Управление', callback_data: 'tgmenu:open' }],
        ],
      },
    };
  }

  async function getNextProfile() {
    const database = await getDatabase();
    return database.get(
      `SELECT rowid AS telegram_id, url, name, username, bio, photo, photo_local
       FROM profiles
       WHERE COALESCE(TRIM(vote), '') = ''
         AND COALESCE(TRIM(username), '') != ''
       ORDER BY timestamp DESC, rowid DESC
       LIMIT 1`
    );
  }

  async function sendNextProfile(chatId) {
    const profile = await getNextProfile();
    if (!profile) {
      await sendMessage(chatId, 'Непросмотренных анкет больше нет.');
      return;
    }

    const card = buildProfileCard(profile);
    const localPhotoPath = getLocalPhotoPath(profile.photo_local);
    try {
      if (localPhotoPath) {
        const buffer = await fs.readFile(localPhotoPath);
        await sendPhoto(chatId, localPhotoPath, card.caption, card.replyMarkup, {
          path: localPhotoPath,
          buffer,
        });
        return;
      }
      if (profile.photo) {
        await sendPhoto(chatId, profile.photo, card.caption, card.replyMarkup);
        return;
      }
    } catch (error) {
      console.error('[TELEGRAM BOT] Ошибка отправки фото анкеты:', error.message);
    }
    await sendMessage(chatId, card.caption, { reply_markup: card.replyMarkup });
  }

  async function sendControlMenu(chatId) {
    const status = await executor.getStatus();
    const profileFarmRunning = !!status.workers?.index;
    const donorFarmRunning = !!status.workers?.parser;
    const massRunning = !!status.mass?.running;
    await sendMessage(chatId, 'Управление процессами', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `${profileFarmRunning ? '🟢' : '⚪'} Фарм профилей · ${profileFarmRunning ? 'Остановить' : 'Запустить'}`,
              callback_data: `tgmenu:worker:index:${profileFarmRunning ? 'stop' : 'start'}`,
            },
          ],
          [
            {
              text: `${donorFarmRunning ? '🟢' : '⚪'} Фарм доноров · ${donorFarmRunning ? 'Остановить' : 'Запустить'}`,
              callback_data: `tgmenu:worker:parser:${donorFarmRunning ? 'stop' : 'start'}`,
            },
          ],
          [
            {
              text: `${massRunning ? '🟢' : '⚪'} Рассылка · ${massRunning ? 'Остановить' : 'Запустить'}`,
              callback_data: `tgmenu:mass:${massRunning ? 'stop' : 'start'}`,
            },
          ],
          [{ text: '🔄 Обновить', callback_data: 'tgmenu:refresh' }],
        ],
      },
    });
  }

  async function persistOffset(offset) {
    const database = await getDatabase();
    await database.run(
      'UPDATE telegram_bot_config SET update_offset = ?, updated_at = ? WHERE id = 1',
      [offset, new Date().toISOString()]
    );
  }

  async function saveOwner(message) {
    const database = await getDatabase();
    await database.run(
      `UPDATE telegram_bot_config
       SET owner_user_id = ?, owner_chat_id = ?, owner_username = ?, owner_first_name = ?,
           pair_code_hash = NULL, pair_code_expires_at = NULL, updated_at = ?
       WHERE id = 1`,
      [
        String(message.from.id),
        String(message.chat.id),
        message.from.username || null,
        message.from.first_name || null,
        new Date().toISOString(),
      ]
    );
  }

  function ownerMatches(config, from, chat) {
    return (
      !!config?.owner_user_id &&
      String(from?.id || '') === String(config.owner_user_id) &&
      String(chat?.id || '') === String(config.owner_chat_id)
    );
  }

  async function handlePairing(message, code) {
    const config = await getConfig();
    if (!config?.pair_code_hash || !config.pair_code_expires_at) return false;
    if (new Date(config.pair_code_expires_at).getTime() < now()) {
      await sendMessage(message.chat.id, 'Ссылка привязки истекла. Создайте новую в настройках.');
      return true;
    }
    const receivedHash = hashValue(code);
    const expected = Buffer.from(config.pair_code_hash, 'hex');
    const received = Buffer.from(receivedHash, 'hex');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      await sendMessage(
        message.chat.id,
        'Ссылка привязки устарела. Используйте последнюю ссылку из настроек.'
      );
      return true;
    }
    await saveOwner(message);
    await sendMessage(message.chat.id, 'Бот привязан к этому Telegram-пользователю.');
    await sendNextProfile(message.chat.id);
    return true;
  }

  async function executeAndReply(chatId, command, payload) {
    try {
      const result = await executor.execute(command, payload);
      await sendMessage(chatId, formatResult(command, result));
    } catch (error) {
      await sendMessage(chatId, `Ошибка: ${String(error.message || error).slice(0, 1000)}`);
    }
  }

  async function requestConfirmation(message, parsed) {
    if (
      (parsed.command === 'worker.start' || parsed.command === 'worker.stop') &&
      !WORKER_TYPES.has(parsed.payload.type)
    ) {
      await sendMessage(message.chat.id, 'Укажите worker: index, parser или checker.');
      return;
    }
    const nonce = randomBytes(9).toString('base64url');
    confirmations.set(nonce, {
      command: parsed.command,
      payload: parsed.payload,
      userId: String(message.from.id),
      chatId: String(message.chat.id),
      expiresAt: now() + CONFIRM_TTL_MS,
      returnToMenu: !!parsed.returnToMenu,
    });
    await sendMessage(message.chat.id, `${commandLabel(parsed.command, parsed.payload)}?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Подтвердить', callback_data: `tgcfm:${nonce}:yes` },
            { text: 'Отмена', callback_data: `tgcfm:${nonce}:no` },
          ],
        ],
      },
    });
  }

  async function handleMessage(message) {
    const text = String(message?.text || '').trim();
    const startMatch = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)$/i);
    if (startMatch && (await handlePairing(message, startMatch[1]))) return;

    const config = await getConfig();
    if (!ownerMatches(config, message.from, message.chat)) {
      await sendMessage(message.chat.id, 'Доступ запрещён. Создайте ссылку привязки в настройках.');
      return;
    }

    if (/^\/(?:start|next)(?:@\w+)?$/i.test(text)) {
      await sendNextProfile(message.chat.id);
      return;
    }

    if (/^\/menu(?:@\w+)?$/i.test(text)) {
      await sendControlMenu(message.chat.id);
      return;
    }

    if (/^\/help(?:@\w+)?$/i.test(text)) {
      await sendMessage(
        message.chat.id,
        [
          'Команды:',
          '/start — следующая анкета',
          '/next — следующая анкета',
          '/menu — управление процессами',
          '/status',
          '/worker_start index|parser|checker',
          '/worker_stop index|parser|checker',
          '/mass_status',
          '/mass_start',
          '/mass_stop',
          '/schedule',
          '/skip_donor',
        ].join('\n')
      );
      return;
    }

    const parsed = parseCommand(text);
    if (!parsed) {
      await sendMessage(message.chat.id, 'Неизвестная команда. Используйте /help.');
      return;
    }
    if (parsed.mutation) {
      await requestConfirmation(message, parsed);
      return;
    }
    await executeAndReply(message.chat.id, parsed.command, parsed.payload);
  }

  async function handleCallback(callback) {
    const config = await getConfig();
    const data = String(callback?.data || '');
    const isOwner = ownerMatches(config, callback.from, callback.message?.chat);
    if (/^tgmenu:(?:open|refresh)$/.test(data) && isOwner) {
      await request(currentToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
      });
      await sendControlMenu(callback.message.chat.id);
      return;
    }

    const workerMenuMatch = data.match(/^tgmenu:worker:(index|parser):(start|stop)$/);
    const massMenuMatch = data.match(/^tgmenu:mass:(start|stop)$/);
    if ((workerMenuMatch || massMenuMatch) && isOwner) {
      await request(currentToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
      });
      const parsed = workerMenuMatch
        ? {
            command: `worker.${workerMenuMatch[2]}`,
            payload: { type: workerMenuMatch[1] },
            mutation: true,
            returnToMenu: true,
          }
        : {
            command: `mass.${massMenuMatch[1]}`,
            payload: {},
            mutation: true,
            returnToMenu: true,
          };
      await requestConfirmation({ from: callback.from, chat: callback.message.chat }, parsed);
      return;
    }

    const profileMatch = data.match(PROFILE_CALLBACK_PATTERN);
    if (profileMatch && isOwner) {
      const database = await getDatabase();
      const result = await database.run(
        `UPDATE profiles
         SET vote = ?
         WHERE rowid = ? AND COALESCE(TRIM(vote), '') = ''`,
        [profileMatch[2], Number(profileMatch[1])]
      );
      await request(currentToken, 'answerCallbackQuery', {
        callback_query_id: callback.id,
        text:
          result.changes > 0
            ? profileMatch[2] === 'like'
              ? 'Лайк поставлен'
              : 'Анкета пропущена'
            : 'Анкета уже оценена',
      });
      if (result.changes > 0) await sendNextProfile(callback.message.chat.id);
      return;
    }

    const match = data.match(/^tgcfm:([A-Za-z0-9_-]+):(yes|no)$/);
    if (!match || !ownerMatches(config, callback.from, callback.message?.chat)) return;

    await request(currentToken, 'answerCallbackQuery', {
      callback_query_id: callback.id,
      text: match[2] === 'yes' ? 'Команда принята' : 'Отменено',
    });
    const pending = confirmations.get(match[1]);
    confirmations.delete(match[1]);
    if (
      !pending ||
      pending.expiresAt < now() ||
      pending.userId !== String(callback.from.id) ||
      pending.chatId !== String(callback.message.chat.id)
    ) {
      await sendMessage(callback.message.chat.id, 'Подтверждение устарело.');
      return;
    }
    if (match[2] === 'no') return;
    await executeAndReply(pending.chatId, pending.command, pending.payload);
    if (pending.returnToMenu) await sendControlMenu(pending.chatId);
  }

  async function handleUpdate(update) {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  }

  async function pollLoop(initialOffset, signal) {
    let offset = Number(initialOffset || 0);
    let failures = 0;
    while (running && !signal.aborted) {
      try {
        const updates = await request(
          currentToken,
          'getUpdates',
          {
            offset,
            timeout: POLL_TIMEOUT_SECONDS,
            allowed_updates: ['message', 'callback_query'],
          },
          { timeoutMs: (POLL_TIMEOUT_SECONDS + 10) * 1000, signal }
        );
        connected = true;
        lastError = null;
        lastSuccessAt = new Date().toISOString();
        failures = 0;
        for (const update of updates || []) {
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error('[TELEGRAM BOT] Ошибка update:', error.message);
          }
          offset = Math.max(offset, Number(update.update_id) + 1);
          await persistOffset(offset);
        }
      } catch (error) {
        if (!running || signal.aborted || error.code === 'ABORT_ERR') break;
        connected = false;
        lastError = String(error.message || error).slice(0, 1000);
        failures += 1;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5));
        await delayWithSignal(delay, signal);
      }
    }
    connected = false;
  }

  function formatOperationNotification(event) {
    const { operation, status, details = {} } = event || {};
    if (operation === 'worker.start' && status === 'started') {
      return `Worker ${details.type} запущен.`;
    }
    if (operation === 'worker.start' && status === 'failed') {
      return `Worker ${details.type} не запущен: ${details.error || 'ошибка'}`;
    }
    if (operation === 'worker.lifecycle' && status === 'stopped') {
      return `Worker ${details.type} остановлен, код ${details.code}.`;
    }
    if (operation === 'mass-messaging' && ['completed', 'failed', 'stopped'].includes(status)) {
      return `Рассылка: ${status}${details.sent !== undefined ? `, отправлено ${details.sent}` : ''}.`;
    }
    if (operation === 'schedule-slot' && ['completed', 'failed', 'cancelled'].includes(status)) {
      return `Слот #${details.id}: ${status}${details.sent !== undefined ? `, отправлено ${details.sent}` : ''}.`;
    }
    return null;
  }

  const onOperation = async (event) => {
    const text = formatOperationNotification(event);
    if (!text || !running) return;
    try {
      const config = await getConfig();
      if (config?.owner_chat_id) await sendMessage(config.owner_chat_id, text);
    } catch (error) {
      console.error('[TELEGRAM BOT] Ошибка уведомления:', error.message);
    }
  };

  function subscribeEvents() {
    if (eventSubscribed) return;
    eventSubscribed = true;
    events.on('operation', onOperation);
  }

  function unsubscribeEvents() {
    if (!eventSubscribed) return;
    eventSubscribed = false;
    events.off('operation', onOperation);
  }

  async function start() {
    if (running) return true;
    const config = await getConfig();
    if (!config?.enabled || !config.token_ciphertext) return false;
    currentToken = await getStoredToken(config);
    botUsername = config.bot_username || null;
    running = true;
    connected = false;
    abortController = new AbortController();
    subscribeEvents();
    const signal = abortController.signal;
    loopPromise = (async () => {
      try {
        await request(
          currentToken,
          'deleteWebhook',
          { drop_pending_updates: false },
          { signal }
        );
      } catch (error) {
        if (!signal.aborted) lastError = error.message;
      }
      if (running && !signal.aborted) {
        await pollLoop(config.update_offset, signal);
      }
    })().finally(() => {
      loopPromise = null;
    });
    return true;
  }

  async function stop() {
    running = false;
    abortController?.abort();
    await loopPromise;
    abortController = null;
    unsubscribeEvents();
    connected = false;
    confirmations.clear();
  }

  async function enable() {
    const config = await getConfig();
    if (!config?.token_ciphertext) {
      const error = new Error('Сначала подключите Telegram-бота');
      error.statusCode = 409;
      throw error;
    }
    const database = await getDatabase();
    await database.run(
      'UPDATE telegram_bot_config SET enabled = 1, updated_at = ? WHERE id = 1',
      [new Date().toISOString()]
    );
    await start();
    return getStatus();
  }

  async function disable() {
    const database = await getDatabase();
    await database.run(
      'UPDATE telegram_bot_config SET enabled = 0, updated_at = ? WHERE id = 1',
      [new Date().toISOString()]
    );
    await stop();
    lastError = null;
    return getStatus();
  }

  async function configure(token) {
    const normalized = String(token || '').trim();
    if (!TOKEN_PATTERN.test(normalized)) {
      const error = new Error('Некорректный BotFather token');
      error.statusCode = 400;
      throw error;
    }
    const me = await request(normalized, 'getMe');
    if (!me?.id || !me?.username) throw new Error('Telegram bot identity не получена');

    await stop();
    const database = await getDatabase();
    const previous = await getConfig();
    const sameBot = String(previous?.bot_id || '') === String(me.id);
    const encrypted = await encryptToken(normalized);
    const timestamp = new Date().toISOString();
    await database.run(
      `INSERT INTO telegram_bot_config (
         id, token_ciphertext, bot_id, bot_username,
         owner_user_id, owner_chat_id, owner_username, owner_first_name,
         pair_code_hash, pair_code_expires_at, update_offset, enabled, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         token_ciphertext = excluded.token_ciphertext,
         bot_id = excluded.bot_id,
         bot_username = excluded.bot_username,
         owner_user_id = excluded.owner_user_id,
         owner_chat_id = excluded.owner_chat_id,
         owner_username = excluded.owner_username,
         owner_first_name = excluded.owner_first_name,
         pair_code_hash = NULL,
         pair_code_expires_at = NULL,
         update_offset = excluded.update_offset,
         enabled = 1,
         updated_at = excluded.updated_at`,
      [
        encrypted,
        String(me.id),
        me.username,
        sameBot ? previous.owner_user_id : null,
        sameBot ? previous.owner_chat_id : null,
        sameBot ? previous.owner_username : null,
        sameBot ? previous.owner_first_name : null,
        sameBot ? Number(previous.update_offset || 0) : 0,
        timestamp,
      ]
    );
    await start();
    return getStatus();
  }

  async function remove() {
    await stop();
    const database = await getDatabase();
    await database.run('DELETE FROM telegram_bot_config WHERE id = 1');
    currentToken = null;
    botUsername = null;
    lastError = null;
    lastSuccessAt = null;
    return { success: true };
  }

  async function createPairing() {
    const config = await getConfig();
    if (!config?.bot_username || !config.token_ciphertext) {
      const error = new Error('Сначала подключите Telegram-бота');
      error.statusCode = 409;
      throw error;
    }
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(now() + PAIR_TTL_MS).toISOString();
    const database = await getDatabase();
    await database.run(
      `UPDATE telegram_bot_config
       SET pair_code_hash = ?, pair_code_expires_at = ?, updated_at = ?
       WHERE id = 1`,
      [hashValue(code), expiresAt, new Date().toISOString()]
    );
    return {
      deepLink: `https://t.me/${config.bot_username}?start=${code}`,
      expiresAt,
    };
  }

  async function unpair() {
    const database = await getDatabase();
    await database.run(
      `UPDATE telegram_bot_config
       SET owner_user_id = NULL, owner_chat_id = NULL, owner_username = NULL,
           owner_first_name = NULL, pair_code_hash = NULL, pair_code_expires_at = NULL,
           updated_at = ?
       WHERE id = 1`,
      [new Date().toISOString()]
    );
    confirmations.clear();
    return { success: true };
  }

  async function getStatus() {
    const config = await getConfig();
    return {
      configured: !!config?.token_ciphertext,
      enabled: !!config?.enabled,
      running,
      connected,
      botUsername: config?.bot_username || botUsername,
      owner: config?.owner_user_id
        ? {
            userId: config.owner_user_id,
            username: config.owner_username,
            firstName: config.owner_first_name,
          }
        : null,
      pairingExpiresAt: config?.pair_code_expires_at || null,
      lastSuccessAt,
      lastError,
    };
  }

  return {
    start,
    stop,
    enable,
    disable,
    configure,
    remove,
    createPairing,
    unpair,
    getStatus,
    handleUpdate,
  };
}

const telegramBotService = createTelegramBotService();

module.exports = {
  TOKEN_PATTERN,
  PAIR_TTL_MS,
  hashValue,
  telegramRequest,
  parseCommand,
  formatStatus,
  formatResult,
  createTelegramBotService,
  telegramBotService,
};
