'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const ctx = require('./server-context');
const utils = require('./utils');
const {
  tryAcquireInstagramActivity,
  releaseInstagramActivity,
  getInstagramActivity,
} = require('./instagram-activity');
const { emitOperationEvent } = require('./operation-events');

const WORKER_TYPES = Object.freeze(['index', 'parser', 'checker']);

function createInstagramWorkerService(dependencies = {}) {
  const processes = dependencies.botProcesses || ctx.botProcesses;
  const spawn = dependencies.spawn || childProcess.spawn;
  const fileSystem = dependencies.fs || fs;
  const rootPath = dependencies.getRootPath || utils.getRootPath;
  const refreshSession = dependencies.refreshSession || ctx.refreshSession;
  const broadcastLog = dependencies.broadcastLog || ctx.broadcastLog;
  const emitEvent = dependencies.emitOperationEvent || emitOperationEvent;
  const acquireActivity = dependencies.tryAcquireInstagramActivity || tryAcquireInstagramActivity;
  const releaseActivity = dependencies.releaseInstagramActivity || releaseInstagramActivity;
  const currentActivity = dependencies.getInstagramActivity || getInstagramActivity;
  const runtime = dependencies.process || process;
  const backendDir = dependencies.backendDir || path.join(__dirname, '..');

  function validateType(type) {
    if (!WORKER_TYPES.includes(type)) {
      const error = new Error('Invalid bot type');
      error.code = 'INVALID_WORKER_TYPE';
      error.statusCode = 400;
      throw error;
    }
  }

  function getStatus() {
    return Object.fromEntries(WORKER_TYPES.map((type) => [type, !!processes[type]]));
  }

  function start(type) {
    validateType(type);
    if (processes[type]) {
      return { success: false, error: 'Bot already running', statusCode: 200 };
    }

    const activityLease = acquireActivity(type);
    if (!activityLease) {
      return {
        success: false,
        error: `Instagram activity already running: ${currentActivity()?.type || 'unknown'}`,
        statusCode: 409,
      };
    }

    refreshSession();
    const isPkg = runtime.pkg !== undefined;
    const useE2eStub = runtime.env.E2E_TEST === '1';
    const scriptPath = useE2eStub
      ? path.join(backendDir, 'e2e', `${type}-stub.js`)
      : path.join(backendDir, `${type}.js`);

    if (!isPkg && !fileSystem.existsSync(scriptPath)) {
      releaseActivity(activityLease);
      return {
        success: false,
        error: `Script for ${type} not found at ${scriptPath}`,
        statusCode: 404,
      };
    }

    const runner = isPkg ? runtime.execPath : 'node';
    const cwd = isPkg ? path.dirname(runtime.execPath) : backendDir;
    let child;
    try {
      child = spawn(runner, [scriptPath], {
        cwd,
        env: { ...runtime.env, FORCE_COLOR: '1' },
        shell: false,
      });
    } catch (error) {
      releaseActivity(activityLease);
      emitEvent('worker.start', 'failed', { type, error: error.message });
      return { success: false, error: error.message, statusCode: 500 };
    }

    processes[type] = child;
    emitEvent('worker.start', 'started', { type, pid: child.pid || null });

    child.on('error', (error) => {
      broadcastLog(`${type}-error`, `Failed to start process: ${error.message}`);
      if (processes[type] === child) processes[type] = null;
      releaseActivity(activityLease);
      emitEvent('worker.start', 'failed', { type, error: error.message });
    });
    child.stdout?.on('data', (data) => broadcastLog(type, data.toString()));
    child.stderr?.on('data', (data) => broadcastLog(`${type}-error`, data.toString()));
    child.on('close', (code) => {
      broadcastLog('system', `${type} bot exited with code ${code}`);
      if (processes[type] === child) processes[type] = null;
      releaseActivity(activityLease);
      emitEvent('worker.lifecycle', 'stopped', { type, code });
    });

    return { success: true, statusCode: 200 };
  }

  function killOrphan(type) {
    const scriptName = `${type}.js`;
    let killer;
    if (runtime.platform === 'win32') {
      killer = spawn(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'backend[\\\\/]${scriptName.replace('.', '\\.')}(\\s|"|$)' -and $_.CommandLine -notmatch 'server\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { stdio: 'ignore', windowsHide: true }
      );
    } else {
      killer = spawn('pkill', ['-f', `backend/${scriptName}`], { stdio: 'ignore' });
    }
    killer?.on?.('error', () => {});
  }

  async function stop(type, options = {}) {
    validateType(type);
    const child = processes[type];
    if (!child) {
      killOrphan(type);
      emitEvent('worker.stop', 'requested', { type, tracked: false });
      return {
        success: true,
        message: 'Процесс не отслеживался — отправлен сигнал остановки',
      };
    }

    const timeoutMs = options.timeoutMs ?? 5000;
    emitEvent('worker.stop', 'requested', { type, tracked: true, pid: child.pid || null });

    return new Promise((resolve) => {
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        if (processes[type] === child) processes[type] = null;
        emitEvent('worker.stop', 'timeout', { type });
        finish({ success: true, message: 'Stop timeout' });
      }, timeoutMs);

      child.once('close', () => finish({ success: true }));

      if (runtime.platform === 'win32') {
        try {
          child.kill();
        } catch (error) {
          emitEvent('worker.stop', 'signal-failed', { type, error: error.message });
        }
        const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer?.on?.('error', () => {});
      } else {
        child.kill('SIGTERM');
      }
    });
  }

  function skipDonor() {
    try {
      console.log('📢 [API] Получен запрос на пропуск текущего донора...');
      fileSystem.writeFileSync(path.join(rootPath(), 'data', 'skip_donor.flag'), 'skip');
      emitEvent('donor.skip', 'requested');
      return { success: true, message: 'Сигнал пропуска донора отправлен' };
    } catch (error) {
      console.error('❌ [API] Ошибка при создании skip_donor.flag:', error);
      emitEvent('donor.skip', 'failed', { error: error.message });
      return { success: false, error: 'Ошибка при отправке сигнала' };
    }
  }

  return {
    getStatus,
    start,
    stop,
    skipDonor,
    validateType,
  };
}

const instagramWorkerService = createInstagramWorkerService();

module.exports = {
  WORKER_TYPES,
  createInstagramWorkerService,
  instagramWorkerService,
};
