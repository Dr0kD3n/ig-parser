'use strict';

const { instagramWorkerService } = require('./instagram-worker-service');
const {
  getMassMessengerStatus,
  startMassMessaging,
  stopMassMessaging,
} = require('./mass-messenger');
const { getNextPendingSlot } = require('./message-scheduler');
const { getInstagramActivity } = require('./instagram-activity');

const WORKER_TYPES = new Set(['index', 'parser', 'checker']);

const COMMAND_SCHEMAS = Object.freeze({
  'status.get': { keys: [] },
  'worker.start': { keys: ['type'], validate: validateWorkerType },
  'worker.stop': { keys: ['type'], validate: validateWorkerType },
  'mass.status': { keys: [] },
  'mass.start': { keys: [] },
  'mass.stop': { keys: [] },
  'schedule.status': { keys: [] },
  'donor.skip': { keys: [] },
});

function validateWorkerType(payload) {
  if (!WORKER_TYPES.has(payload.type)) {
    throw new Error('Некорректный worker type');
  }
}

function assertPayload(command, payload) {
  const schema = COMMAND_SCHEMAS[command];
  if (!schema) throw new Error('Telegram command запрещена');

  const keys = Object.keys(payload || {});
  const unexpected = keys.filter((key) => !schema.keys.includes(key));
  if (unexpected.length) {
    throw new Error(`Недопустимые поля: ${unexpected.join(', ')}`);
  }
  for (const key of schema.keys) {
    if (payload?.[key] === undefined || payload?.[key] === null || payload?.[key] === '') {
      throw new Error(`Обязательное поле: ${key}`);
    }
  }
  if (schema.validate) schema.validate(payload || {});
}

function createTelegramCommandExecutor(dependencies = {}) {
  const workers = dependencies.workerService || instagramWorkerService;
  const massStatus = dependencies.getMassMessengerStatus || getMassMessengerStatus;
  const startMass = dependencies.startMassMessaging || startMassMessaging;
  const stopMass = dependencies.stopMassMessaging || stopMassMessaging;
  const nextSlot = dependencies.getNextPendingSlot || getNextPendingSlot;
  const activity = dependencies.getInstagramActivity || getInstagramActivity;

  async function getStatus() {
    const [schedule, currentActivity] = await Promise.all([
      nextSlot(),
      Promise.resolve(activity()),
    ]);
    const currentMass = massStatus();
    return {
      workers: workers.getStatus(),
      activity: currentActivity?.type || null,
      mass: {
        running: !!currentMass?.running,
        status: currentMass?.status || '',
        current: Number(currentMass?.current || 0),
        total: Number(currentMass?.total || 0),
      },
      schedule: schedule
        ? {
            id: schedule.id,
            title: schedule.title || '',
            startAt: schedule.startAt,
            status: schedule.status,
          }
        : null,
    };
  }

  async function execute(command, payload = {}) {
    assertPayload(command, payload);

    switch (command) {
      case 'status.get':
        return getStatus();
      case 'worker.start':
        return workers.start(payload.type);
      case 'worker.stop':
        return workers.stop(payload.type);
      case 'mass.status':
        return {
          running: !!massStatus()?.running,
          status: massStatus()?.status || '',
          current: Number(massStatus()?.current || 0),
          total: Number(massStatus()?.total || 0),
        };
      case 'mass.start':
        if (massStatus()?.running) {
          return { success: false, error: 'Рассылка уже запущена.' };
        }
        if (activity()) {
          return {
            success: false,
            error: `Instagram activity already running: ${activity()?.type || 'unknown'}`,
          };
        }
        Promise.resolve(startMass(null, {})).catch((error) => {
          console.error('[TELEGRAM BOT] Ошибка массовой рассылки:', error.message);
        });
        return { success: true, message: 'Массовая рассылка запущена.' };
      case 'mass.stop':
        stopMass();
        return { success: true, message: 'Остановка рассылки запрошена.' };
      case 'schedule.status': {
        const next = await nextSlot();
        return {
          next: next
            ? {
                id: next.id,
                title: next.title || '',
                startAt: next.startAt,
                status: next.status,
              }
            : null,
        };
      }
      case 'donor.skip':
        return workers.skipDonor();
      default:
        throw new Error('Telegram command запрещена');
    }
  }

  return { execute, getStatus, assertPayload };
}

const telegramCommandExecutor = createTelegramCommandExecutor();

module.exports = {
  COMMAND_SCHEMAS,
  createTelegramCommandExecutor,
  telegramCommandExecutor,
};
