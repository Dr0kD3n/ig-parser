'use strict';

const { error: logError } = require('./logger');
const { BaseError } = require('./errors');

function handleError(error) {
  if (error instanceof BaseError) {
    logError(
      `${error.name} [${error.timestamp}]: ${error.message}${error.context ? ' | context: ' + JSON.stringify(error.context) : ''}`
    );
    if (error.stack) {
      // Log stack trace but maybe not to the main app log file if it's too noisy
      // For now, let's keep it in console at least
      console.error(error.stack);
    }
  } else {
    logError(`Unexpected Error: ${error.message || error}`);
    if (error.stack) console.error(error.stack);
  }

  // If it's not operational, we might want to exit or restart
  if (error.isOperational === false) {
    console.error('FATAL ERROR: System is in non-operational state. Exiting...');
    process.exit(1);
  }
}

function expressErrorHandler(err, req, res, next) {
  const isOperational = err instanceof BaseError ? err.isOperational : false;

  handleError(err);

  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      name: err.name || 'InternalServerError',
      message: err.message || 'An unexpected error occurred',
      timestamp: err.timestamp || new Date().toISOString(),
    },
  });
}

function setupProcessHandlers() {
  const isBenignStreamError = (error) =>
    error &&
    ['ECONNRESET', 'EPIPE', 'ERR_STREAM_WRITE_AFTER_END', 'ECANCELED', 'ERR_STREAM_DESTROYED'].includes(
      error.code
    );

  process.on('uncaughtException', (error) => {
    if (isBenignStreamError(error)) {
      console.error('[WARN] Ошибка клиентского соединения (игнорируется):', error.message);
      return;
    }
    handleError(error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    if (isBenignStreamError(reason)) {
      console.error('[WARN] Ошибка promise-соединения (игнорируется):', reason.message);
      return;
    }
    handleError(reason);
  });
}

module.exports = {
  handleError,
  expressErrorHandler,
  setupProcessHandlers,
};
