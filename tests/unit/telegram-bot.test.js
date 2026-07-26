import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

const { encryptToken, decryptToken } = require('../../backend/lib/telegram-credential-store');
const {
  createTelegramBotService,
  parseCommand,
} = require('../../backend/lib/telegram-bot-service');
const { createTelegramCommandExecutor } = require('../../backend/lib/telegram-command-executor');

function createConfigDatabase(initial = null) {
  let config = initial ? { ...initial } : null;
  return {
    get config() {
      return config;
    },
    get: vi.fn(async () => config),
    run: vi.fn(async (query, params = []) => {
      if (query.includes('INSERT INTO telegram_bot_config')) {
        config = {
          id: 1,
          token_ciphertext: params[0],
          bot_id: params[1],
          bot_username: params[2],
          owner_user_id: params[3],
          owner_chat_id: params[4],
          owner_username: params[5],
          owner_first_name: params[6],
          update_offset: params[7],
          enabled: 1,
          updated_at: params[8],
        };
      } else if (query.includes('SET pair_code_hash')) {
        config.pair_code_hash = params[0];
        config.pair_code_expires_at = params[1];
      } else if (query.includes('SET owner_user_id = ?')) {
        config.owner_user_id = params[0];
        config.owner_chat_id = params[1];
        config.owner_username = params[2];
        config.owner_first_name = params[3];
        config.pair_code_hash = null;
        config.pair_code_expires_at = null;
      } else if (query.includes('SET owner_user_id = NULL')) {
        config.owner_user_id = null;
        config.owner_chat_id = null;
        config.owner_username = null;
        config.owner_first_name = null;
      } else if (query.includes('SET update_offset')) {
        config.update_offset = params[0];
      } else if (query.includes('DELETE FROM telegram_bot_config')) {
        config = null;
      }
      return { changes: 1 };
    }),
  };
}

describe('local Telegram bot', () => {
  it('шифрует BotFather token через AES-256-GCM', () => {
    const key = Buffer.alloc(32, 4);
    const encrypted = encryptToken('123456:secret-token', key);

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain('secret-token');
    expect(decryptToken(encrypted, key)).toBe('123456:secret-token');
    expect(() => decryptToken(encrypted, Buffer.alloc(32, 5))).toThrow();
  });

  it('разбирает только разрешённые команды', () => {
    expect(parseCommand('/worker_start parser')).toEqual({
      command: 'worker.start',
      payload: { type: 'parser' },
      mutation: true,
    });
    expect(parseCommand('/status@my_bot')).toEqual({
      command: 'status.get',
      payload: {},
      mutation: false,
    });
    expect(parseCommand('/request http://localhost')).toBeNull();
  });

  it('привязывает владельца только по одноразовой ссылке', async () => {
    const database = createConfigDatabase({
      id: 1,
      token_ciphertext: 'encrypted',
      bot_username: 'local_ig_bot',
      enabled: 1,
      update_offset: 0,
    });
    const execute = vi.fn(async () => ({
      workers: {},
      mass: {},
      schedule: null,
      activity: null,
    }));
    const service = createTelegramBotService({
      getDB: async () => database,
      commandExecutor: { execute },
      operationEvents: new EventEmitter(),
      randomBytes: () => Buffer.alloc(18, 7),
      now: () => Date.parse('2026-07-25T12:00:00.000Z'),
    });

    const pairing = await service.createPairing();
    const code = new URL(pairing.deepLink).searchParams.get('start');
    await service.handleUpdate({
      message: {
        text: `/start ${code}`,
        from: { id: 42, username: 'owner', first_name: 'Owner' },
        chat: { id: 100 },
      },
    });

    expect(database.config.owner_user_id).toBe('42');
    await service.handleUpdate({
      message: {
        text: '/status',
        from: { id: 99 },
        chat: { id: 101 },
      },
    });
    expect(execute).not.toHaveBeenCalled();

    await service.handleUpdate({
      message: {
        text: '/status',
        from: { id: 42 },
        chat: { id: 100 },
      },
    });
    expect(execute).toHaveBeenCalledWith('status.get', {});
  });

  it('запускает polling после проверки token и останавливает его', async () => {
    const database = createConfigDatabase();
    const telegramRequest = vi.fn(async (_token, method, _payload, options = {}) => {
      if (method === 'getMe') return { id: 77, username: 'local_ig_bot' };
      if (method === 'deleteWebhook') return true;
      if (method === 'getUpdates') {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              const error = new Error('stopped');
              error.code = 'ABORT_ERR';
              reject(error);
            },
            { once: true }
          );
        });
      }
      return true;
    });
    const service = createTelegramBotService({
      getDB: async () => database,
      telegramRequest,
      commandExecutor: { execute: vi.fn() },
      operationEvents: new EventEmitter(),
      encryptTelegramToken: async (token) => `encrypted:${token}`,
      decryptTelegramToken: async (value) => value.replace('encrypted:', ''),
    });

    const configured = await service.configure('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi');
    expect(configured.running).toBe(true);
    expect(configured.botUsername).toBe('local_ig_bot');

    await service.stop();
    expect((await service.getStatus()).running).toBe(false);
  });

  it('исполнитель не допускает произвольные операции', async () => {
    const start = vi.fn(() => ({ success: true }));
    const executor = createTelegramCommandExecutor({
      workerService: {
        getStatus: () => ({ index: false, parser: false, checker: false }),
        validateType: vi.fn(),
        start,
        stop: vi.fn(),
        skipDonor: vi.fn(),
      },
      getMassMessengerStatus: () => ({ running: false }),
      stopMassMessaging: vi.fn(),
      getNextPendingSlot: async () => null,
      getInstagramActivity: () => null,
    });

    await expect(executor.execute('http.request', { url: 'http://localhost' })).rejects.toThrow(
      'Telegram command запрещена'
    );
    await expect(
      executor.execute('worker.start', { type: 'parser', url: 'http://localhost' })
    ).rejects.toThrow('Недопустимые поля');
    await expect(executor.execute('worker.start', { type: 'parser' })).resolves.toEqual({
      success: true,
    });
    expect(start).toHaveBeenCalledWith('parser');
  });

  it('mutating command требует подтверждения владельца', async () => {
    const database = createConfigDatabase({
      id: 1,
      token_ciphertext: 'encrypted:old',
      bot_id: '77',
      bot_username: 'local_ig_bot',
      owner_user_id: '42',
      owner_chat_id: '100',
      owner_username: 'owner',
      owner_first_name: 'Owner',
      enabled: 1,
      update_offset: 0,
    });
    const execute = vi.fn(async () => ({ success: true, message: 'ok' }));
    const telegramRequest = vi.fn(async (_token, method, _payload, options = {}) => {
      if (method === 'getMe') return { id: 77, username: 'local_ig_bot' };
      if (method === 'deleteWebhook') return true;
      if (method === 'sendMessage') return { message_id: 1 };
      if (method === 'answerCallbackQuery') return true;
      if (method === 'getUpdates') {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('stopped');
              error.code = 'ABORT_ERR';
              reject(error);
            },
            { once: true }
          );
        });
      }
      return true;
    });
    const service = createTelegramBotService({
      getDB: async () => database,
      telegramRequest,
      commandExecutor: { execute },
      operationEvents: new EventEmitter(),
      randomBytes: () => Buffer.from('confirm123'),
      now: () => Date.parse('2026-07-25T12:00:00.000Z'),
      encryptTelegramToken: async (token) => `encrypted:${token}`,
      decryptTelegramToken: async (value) => value.replace('encrypted:', ''),
    });
    await service.configure('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi');

    await service.handleUpdate({
      message: {
        text: '/worker_start parser',
        from: { id: 42 },
        chat: { id: 100 },
      },
    });
    expect(execute).not.toHaveBeenCalled();

    const confirmCall = telegramRequest.mock.calls.find(
      ([, method, payload]) => method === 'sendMessage' && payload?.reply_markup
    );
    const callbackData = confirmCall[2].reply_markup.inline_keyboard[0][0].callback_data;

    await service.handleUpdate({
      callback_query: {
        id: 'cb-1',
        data: callbackData,
        from: { id: 42 },
        message: { chat: { id: 100 } },
      },
    });
    expect(execute).toHaveBeenCalledWith('worker.start', { type: 'parser' });
    await service.stop();
  });
});
