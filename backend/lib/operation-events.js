'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');

const operationEvents = new EventEmitter();
operationEvents.setMaxListeners(50);

function emitOperationEvent(operation, status, details = {}) {
  const event = {
    id: crypto.randomUUID(),
    type: 'operation',
    operation,
    status,
    timestamp: new Date().toISOString(),
    details,
  };
  try {
    operationEvents.emit('operation', event);
  } catch (error) {
    console.error('[OPERATION EVENT] Ошибка listener:', error.message);
  }
  return event;
}

module.exports = {
  operationEvents,
  emitOperationEvent,
};
