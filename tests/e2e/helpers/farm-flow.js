/** Хелперы для E2E сценария фарма / рассылки */

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:1337';

async function resetE2eState(request) {
  const res = await request.post(`${BACKEND_URL}/api/e2e/reset`);
  if (!res.ok()) {
    throw new Error(`E2E reset failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function getE2eState(request) {
  const res = await request.get(`${BACKEND_URL}/api/e2e/state`);
  if (!res.ok()) {
    throw new Error(`E2E state failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function waitForBotIdle(request, type, timeoutMs = 30000) {
  const startedAt = Date.now();
  let sawRunning = false;

  while (Date.now() - startedAt < timeoutMs) {
    const res = await request.get(`${BACKEND_URL}/api/bot/status`);
    const status = await res.json();

    if (status[type]) sawRunning = true;
    if (sawRunning && !status[type]) return status;

    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`Bot "${type}" did not finish within ${timeoutMs}ms`);
}

async function waitForProfilesCount(request, expectedCount, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getE2eState(request);
    if (state.profilesCount >= expectedCount) return state;
    await new Promise((r) => setTimeout(r, 300));
  }

  const finalState = await getE2eState(request);
  throw new Error(`Expected ${expectedCount} profiles, got ${finalState.profilesCount}`);
}

async function waitForDonorsCount(request, minCount, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getE2eState(request);
    if (state.donorsCount >= minCount) return state;
    await new Promise((r) => setTimeout(r, 300));
  }

  const finalState = await getE2eState(request);
  throw new Error(`Expected at least ${minCount} donors, got ${finalState.donorsCount}`);
}

async function waitForMassMessagingDone(request, timeoutMs = 30000) {
  const startedAt = Date.now();
  let sawRunning = false;

  while (Date.now() - startedAt < timeoutMs) {
    const res = await request.get(`${BACKEND_URL}/api/mass-messages/status`);
    const status = await res.json();

    if (status.running) sawRunning = true;
    if (sawRunning && !status.running) return status;
    if (!status.running && status.status === 'Done') return status;

    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`Mass messaging did not finish within ${timeoutMs}ms`);
}

module.exports = {
  BACKEND_URL,
  resetE2eState,
  getE2eState,
  waitForBotIdle,
  waitForProfilesCount,
  waitForDonorsCount,
  waitForMassMessagingDone,
};
