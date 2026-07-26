'use strict';

let activeLease = null;

function tryAcquireInstagramActivity(type) {
  if (activeLease) return null;
  const lease = { type, token: Symbol(type), startedAt: Date.now() };
  activeLease = lease;
  return lease;
}

function releaseInstagramActivity(lease) {
  if (!lease || activeLease?.token !== lease.token) return false;
  activeLease = null;
  return true;
}

function getInstagramActivity() {
  if (!activeLease) return null;
  return {
    type: activeLease.type,
    startedAt: activeLease.startedAt,
  };
}

module.exports = {
  tryAcquireInstagramActivity,
  releaseInstagramActivity,
  getInstagramActivity,
};
