'use strict';

const { getDB } = require('./db');
const { startMassMessaging, getMassMessengerStatus } = require('./mass-messenger');
const { getInstagramActivity } = require('./instagram-activity');
const { emitOperationEvent } = require('./operation-events');

const TICK_MS = 5_000;
const MISSED_GRACE_MS = 30 * 60 * 1000;
const REST_AFTER_MS = 30 * 60 * 1000;
const REPEAT_RULES = ['none', 'daily', 'weekly', 'weekdays', 'weekends'];
const REPEAT_HORIZON_DAYS = 56;
const REPEAT_MAX_INSTANCES = 40;
let tickTimer = null;
let tickInProgress = false;
let schedulerRestUntil = 0;

function normalizeRepeatRule(value) {
  const v = String(value || 'none').toLowerCase();
  return REPEAT_RULES.includes(v) ? v : 'none';
}

function getNextOccurrenceDate(startAtIso, repeatRule) {
  const repeat = normalizeRepeatRule(repeatRule);
  if (repeat === 'none') return null;
  const d = new Date(startAtIso);
  if (Number.isNaN(d.getTime())) return null;

  if (repeat === 'daily') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (repeat === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (repeat === 'weekdays') {
    do {
      d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
  }
  if (repeat === 'weekends') {
    do {
      d.setDate(d.getDate() + 1);
    } while (d.getDay() !== 0 && d.getDay() !== 6);
    return d;
  }
  return null;
}

async function insertSeriesChild(db, templateRow, rootId, nextStart, nextEnd, now) {
  const repeatRule = normalizeRepeatRule(templateRow.repeat_rule);
  return db.run(
    `INSERT INTO message_schedule_slots
     (title, start_at, end_at, count, city_only, except_city, liked_only, show_browser, rest_after, repeat_rule, series_id, enabled, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      templateRow.title || '',
      nextStart.toISOString(),
      nextEnd.toISOString(),
      templateRow.count || 20,
      templateRow.city_only ? 1 : 0,
      templateRow.except_city ? 1 : 0,
      templateRow.liked_only ? 1 : 0,
      templateRow.show_browser ? 1 : 0,
      templateRow.rest_after ? 1 : 0,
      repeatRule,
      rootId,
      templateRow.enabled ? 1 : 0,
      now,
      now,
    ]
  );
}

async function getSeriesTemplateRow(db, slotRow) {
  const rootId = slotRow.series_id || slotRow.id;
  if (!slotRow.series_id) return slotRow;
  return db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [rootId]) || slotRow;
}

async function materializeSeriesOccurrences(db, slotRow) {
  const template = await getSeriesTemplateRow(db, slotRow);
  const repeatRule = normalizeRepeatRule(template.repeat_rule);
  if (repeatRule === 'none') return 0;

  const rootId = template.series_id || template.id;
  const horizonMs = Date.now() + REPEAT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const startMs = new Date(template.start_at).getTime();
  const endMs = template.end_at
    ? new Date(template.end_at).getTime()
    : startMs + 60 * 60 * 1000;
  const durationMs = endMs - startMs;

  const latest = await db.get(
    `SELECT start_at FROM message_schedule_slots
     WHERE id = ? OR series_id = ?
     ORDER BY start_at DESC LIMIT 1`,
    [rootId, rootId]
  );
  let cursor = latest?.start_at || template.start_at;
  let created = 0;
  const now = new Date().toISOString();

  while (created < REPEAT_MAX_INSTANCES) {
    const nextStart = getNextOccurrenceDate(cursor, repeatRule);
    if (!nextStart || nextStart.getTime() > horizonMs) break;

    const dup = await db.get(
      `SELECT id FROM message_schedule_slots
       WHERE (id = ? OR series_id = ?) AND start_at = ?`,
      [rootId, rootId, nextStart.toISOString()]
    );
    if (!dup) {
      const nextEnd = new Date(nextStart.getTime() + durationMs);
      await insertSeriesChild(db, template, rootId, nextStart, nextEnd, now);
      created += 1;
      console.log(`[SCHEDULER] Создано повторение · ${nextStart.toISOString()}`);
    }
    cursor = nextStart.toISOString();
  }
  return created;
}

async function spawnNextRepeatSlot(db, slotRow) {
  return materializeSeriesOccurrences(db, slotRow);
}

function normalizeInstant(value) {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error('Некорректная дата');
  return new Date(ms).toISOString();
}

function slotStartMs(row) {
  return new Date(row.start_at).getTime();
}

function rowToSlot(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    startAt: row.start_at,
    endAt: row.end_at,
    count: row.count,
    cityOnly: !!row.city_only,
    exceptCity: !!row.except_city,
    likedOnly: !!row.liked_only,
    showBrowser: !!row.show_browser,
    restAfter: !!row.rest_after,
    repeatRule: normalizeRepeatRule(row.repeat_rule),
    seriesId: row.series_id || null,
    enabled: !!row.enabled,
    status: row.status,
    executedAt: row.executed_at,
    sentCount: row.sent_count || 0,
    failReason: row.fail_reason || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function markMissedSlots(db, nowMs = Date.now()) {
  const cutoffMs = nowMs - MISSED_GRACE_MS;
  const rows = await db.all(
    `SELECT id, start_at FROM message_schedule_slots
     WHERE status = 'pending' AND enabled = 1`
  );
  const ids = rows.filter((r) => slotStartMs(r) < cutoffMs).map((r) => r.id);
  if (!ids.length) return;
  const now = new Date(nowMs).toISOString();
  await db.run(
    `UPDATE message_schedule_slots
     SET status = 'missed', updated_at = ?
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    [now, ...ids]
  );
  for (const id of ids) {
    const row = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [id]);
    if (row) await spawnNextRepeatSlot(db, row);
  }
  console.log(`[SCHEDULER] Пропущено слотов: ${ids.length}`);
}

async function revertSlotToPending(db, slotId) {
  await db.run(
    `UPDATE message_schedule_slots
     SET status = 'pending', executed_at = NULL, updated_at = ?
     WHERE id = ?`,
    [new Date().toISOString(), slotId]
  );
}

async function finishSlot(db, slotId, status, sentCount = 0, failReason = null) {
  await db.run(
    `UPDATE message_schedule_slots
     SET status = ?, sent_count = ?, fail_reason = ?, updated_at = ?
     WHERE id = ?`,
    [status, sentCount, failReason, new Date().toISOString(), slotId]
  );
}

async function runDueSlot(slot) {
  if (getMassMessengerStatus().running) return;
  if (getInstagramActivity()) return;

  const db = await getDB();
  const now = new Date().toISOString();
  const claim = await db.run(
    `UPDATE message_schedule_slots SET status = 'running', executed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
    [now, now, slot.id]
  );
  if (!claim.changes) return;

  console.log(`[SCHEDULER] Запуск слота #${slot.id} · ${slot.count} сообщ. · ${slot.startAt}`);

  try {
    const result = await startMassMessaging(null, {
      cityOnly: slot.cityOnly,
      exceptCity: slot.exceptCity,
      likedOnly: slot.likedOnly,
      showBrowser: slot.showBrowser,
      restAfter: slot.restAfter,
      dmLimit: slot.count,
      scheduleSlotId: slot.id,
    });

    if (!result?.started) {
      if (result?.reason === 'already_running') {
        await revertSlotToPending(db, slot.id);
        console.log(`[SCHEDULER] Слот #${slot.id} отложен — рассылка уже идёт`);
        return;
      }
      const reason = result?.reason || 'unknown';
      await finishSlot(db, slot.id, 'failed', 0, reason);
      const failedRow = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [slot.id]);
      if (failedRow) await spawnNextRepeatSlot(db, failedRow);
      console.log(`[SCHEDULER] Слот #${slot.id} не запущен: ${reason}`);
      emitOperationEvent('schedule-slot', 'failed', { id: slot.id, error: reason });
      return;
    }

    const sentCount = result.sent ?? 0;
    const status = result.stopped ? 'cancelled' : 'completed';
    await finishSlot(db, slot.id, status, sentCount);
    const finishedRow = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [slot.id]);
    if (finishedRow) await spawnNextRepeatSlot(db, finishedRow);
    if (slot.restAfter) {
      schedulerRestUntil = Date.now() + REST_AFTER_MS;
      console.log(`[SCHEDULER] Отдых ${REST_AFTER_MS / 60000} мин после слота #${slot.id}`);
    }
    console.log(`[SCHEDULER] Слот #${slot.id} завершён: ${status}, отправлено ${sentCount}`);
    emitOperationEvent('schedule-slot', status, { id: slot.id, sent: sentCount });
  } catch (err) {
    console.error('[SCHEDULER] Ошибка слота', slot.id, err.message);
    await finishSlot(db, slot.id, 'failed', 0, err.message);
    const failedRow = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [slot.id]);
    if (failedRow) await spawnNextRepeatSlot(db, failedRow);
    emitOperationEvent('schedule-slot', 'failed', { id: slot.id, error: err.message });
  }
}

async function findDueSlot(db, nowMs = Date.now()) {
  const rows = await db.all(
    `SELECT * FROM message_schedule_slots
     WHERE status = 'pending' AND enabled = 1
     ORDER BY start_at ASC`
  );
  return rows.find((row) => slotStartMs(row) <= nowMs) || null;
}

async function tick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    const db = await getDB();
    const nowMs = Date.now();

    if (getMassMessengerStatus().running) return;
    if (getInstagramActivity()) return;

    if (Date.now() < schedulerRestUntil) return;

    const dueRow = await findDueSlot(db, nowMs);
    if (dueRow) {
      await runDueSlot(rowToSlot(dueRow));
      return;
    }

    await markMissedSlots(db, nowMs);
  } finally {
    tickInProgress = false;
  }
}

function startMessageScheduler() {
  if (tickTimer) return;
  tick().catch((err) => console.error('[SCHEDULER] tick error:', err.message));
  tickTimer = setInterval(() => {
    tick().catch((err) => console.error('[SCHEDULER] tick error:', err.message));
  }, TICK_MS);
  console.log('[SCHEDULER] Планировщик рассылок запущен');
}

function stopMessageScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

async function getNextPendingSlot() {
  const db = await getDB();
  const row = await db.get(
    `SELECT * FROM message_schedule_slots
     WHERE status = 'pending' AND enabled = 1
     ORDER BY start_at ASC
     LIMIT 1`
  );
  return rowToSlot(row);
}

async function listSlots(from, to) {
  const db = await getDB();
  const params = [];
  let query = 'SELECT * FROM message_schedule_slots WHERE 1=1';
  if (from) {
    query += ' AND start_at >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND start_at <= ?';
    params.push(to);
  }
  query += ' ORDER BY start_at ASC';
  const rows = await db.all(query, params);
  return rows.map(rowToSlot);
}

async function createSlot(data) {
  const db = await getDB();
  const now = new Date().toISOString();
  const startAt = normalizeInstant(data.startAt);
  const endAt = data.endAt ? normalizeInstant(data.endAt) : null;
  const result = await db.run(
    `INSERT INTO message_schedule_slots
     (title, start_at, end_at, count, city_only, except_city, liked_only, show_browser, rest_after, repeat_rule, enabled, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      data.title || '',
      startAt,
      endAt,
      data.count || 20,
      data.cityOnly ? 1 : 0,
      data.exceptCity ? 1 : 0,
      data.likedOnly ? 1 : 0,
      data.showBrowser ? 1 : 0,
      data.restAfter ? 1 : 0,
      normalizeRepeatRule(data.repeatRule),
      data.enabled !== false ? 1 : 0,
      now,
      now,
    ]
  );
  const row = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [result.lastID]);
  if (normalizeRepeatRule(data.repeatRule) !== 'none') {
    await materializeSeriesOccurrences(db, row);
  }
  const slot = rowToSlot(row);
  let seriesSlots = null;
  if (normalizeRepeatRule(data.repeatRule) !== 'none') {
    const rows = await db.all(
      `SELECT * FROM message_schedule_slots WHERE id = ? OR series_id = ? ORDER BY start_at ASC`,
      [slot.id, slot.id]
    );
    seriesSlots = rows.map(rowToSlot);
  }
  return { slot, seriesSlots };
}

async function getSeriesInfo(slotId) {
  const db = await getDB();
  const slot = await db.get('SELECT id, series_id, repeat_rule FROM message_schedule_slots WHERE id = ?', [slotId]);
  if (!slot) return null;
  const rootId = slot.series_id || slot.id;
  const rootRow = slot.series_id
    ? await db.get('SELECT repeat_rule FROM message_schedule_slots WHERE id = ?', [rootId])
    : slot;
  const rootRepeat = normalizeRepeatRule(rootRow?.repeat_rule);
  const childCount = await db.get(
    'SELECT COUNT(*) as c FROM message_schedule_slots WHERE series_id = ?',
    [rootId]
  );
  const related = await db.all(
    `SELECT id FROM message_schedule_slots
     WHERE (id = ? OR series_id = ?) AND id != ? AND status != 'running'`,
    [rootId, rootId, slotId]
  );
  const isChild = !!slot.series_id;
  const isRepeatingRoot = !slot.series_id && rootRepeat !== 'none';
  const hasChildren = (childCount?.c || 0) > 0;
  const needsScopeChoice = isChild || hasChildren || isRepeatingRoot;
  return {
    slotId,
    rootId,
    isChild,
    isRepeatingRoot,
    hasChildren,
    relatedCount: related.length,
    hasRelated: related.length > 0,
    needsScopeChoice,
    relatedIds: related.map((r) => r.id),
  };
}

function buildSharedFields(data, existing) {
  return {
    title: data.title ?? existing.title ?? '',
    count: data.count ?? existing.count,
    cityOnly: (data.cityOnly ?? !!existing.city_only) ? 1 : 0,
    exceptCity: (data.exceptCity ?? !!existing.except_city) ? 1 : 0,
    likedOnly: (data.likedOnly ?? !!existing.liked_only) ? 1 : 0,
    showBrowser: (data.showBrowser ?? !!existing.show_browser) ? 1 : 0,
    restAfter: (data.restAfter ?? !!existing.rest_after) ? 1 : 0,
    repeatRule: normalizeRepeatRule(data.repeatRule ?? existing.repeat_rule),
    enabled: (data.enabled ?? !!existing.enabled) ? 1 : 0,
  };
}

async function listSeriesSlots(db, rootId) {
  const rows = await db.all(
    `SELECT * FROM message_schedule_slots WHERE id = ? OR series_id = ? ORDER BY start_at ASC`,
    [rootId, rootId]
  );
  return rows.map(rowToSlot);
}

async function applySeriesChildUpdate(db, id, shared, startAt, endAt, now) {
  await db.run(
    `UPDATE message_schedule_slots SET
      title = ?, start_at = ?, end_at = ?, count = ?,
      city_only = ?, except_city = ?, liked_only = ?, show_browser = ?, rest_after = ?, repeat_rule = ?, enabled = ?,
      status = CASE WHEN status IN ('completed','cancelled','missed','failed') THEN 'pending' ELSE status END,
      fail_reason = CASE WHEN status IN ('completed','cancelled','missed','failed') THEN NULL ELSE fail_reason END,
      updated_at = ?
     WHERE id = ? AND status != 'running'`,
    [
      shared.title,
      startAt,
      endAt,
      shared.count,
      shared.cityOnly,
      shared.exceptCity,
      shared.likedOnly,
      shared.showBrowser,
      shared.restAfter,
      shared.repeatRule,
      shared.enabled,
      now,
      id,
    ]
  );
}

async function applySharedUpdate(db, id, shared, now) {
  await db.run(
    `UPDATE message_schedule_slots SET
      title = ?, count = ?,
      city_only = ?, except_city = ?, liked_only = ?, show_browser = ?, rest_after = ?, repeat_rule = ?, enabled = ?,
      status = CASE WHEN status IN ('completed','cancelled','missed','failed') THEN 'pending' ELSE status END,
      fail_reason = CASE WHEN status IN ('completed','cancelled','missed','failed') THEN NULL ELSE fail_reason END,
      updated_at = ?
     WHERE id = ? AND status != 'running'`,
    [
      shared.title,
      shared.count,
      shared.cityOnly,
      shared.exceptCity,
      shared.likedOnly,
      shared.showBrowser,
      shared.restAfter,
      shared.repeatRule,
      shared.enabled,
      now,
      id,
    ]
  );
}

async function updateSlot(id, data, options = {}) {
  const scope = options.scope === 'series' ? 'series' : 'one';
  const db = await getDB();
  const existing = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [id]);
  if (!existing) return null;
  if (existing.status === 'running') {
    throw new Error('Нельзя редактировать выполняющийся слот');
  }

  const now = new Date().toISOString();
  const startAt = data.startAt != null ? normalizeInstant(data.startAt) : existing.start_at;
  const endAt =
    data.endAt != null ? (data.endAt ? normalizeInstant(data.endAt) : null) : existing.end_at;
  const shared = buildSharedFields(data, existing);

  if (scope === 'series') {
    const rootId = existing.series_id || existing.id;
    const oldStartMs = new Date(existing.start_at).getTime();
    const newStartMs = new Date(startAt).getTime();
    const deltaMs = newStartMs - oldStartMs;
    const targets = await db.all(
      `SELECT id, start_at, end_at FROM message_schedule_slots WHERE (id = ? OR series_id = ?) AND status != 'running'`,
      [rootId, rootId]
    );
    for (const t of targets) {
      if (t.id === id) {
        await applySeriesChildUpdate(db, id, shared, startAt, endAt, now);
      } else {
        const childStart = new Date(new Date(t.start_at).getTime() + deltaMs).toISOString();
        const childEnd = t.end_at
          ? new Date(new Date(t.end_at).getTime() + deltaMs).toISOString()
          : null;
        await applySeriesChildUpdate(db, t.id, shared, childStart, childEnd, now);
      }
    }
    const root = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', rootId);
    if (root && normalizeRepeatRule(root.repeat_rule) !== 'none') {
      await materializeSeriesOccurrences(db, root);
    }
    return {
      slot: rowToSlot(await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [id])),
      seriesSlots: await listSeriesSlots(db, rootId),
    };
  }

  await db.run(
    `UPDATE message_schedule_slots SET
      title = ?, start_at = ?, end_at = ?, count = ?,
      city_only = ?, except_city = ?, liked_only = ?, show_browser = ?, rest_after = ?, repeat_rule = ?, enabled = ?,
      series_id = NULL,
      status = CASE WHEN status IN ('completed','cancelled','missed','failed') THEN 'pending' ELSE status END,
      fail_reason = CASE WHEN status IN ('completed','cancelled','missed','failed') THEN NULL ELSE fail_reason END,
      updated_at = ?
     WHERE id = ?`,
    [
      shared.title,
      startAt,
      endAt,
      shared.count,
      shared.cityOnly,
      shared.exceptCity,
      shared.likedOnly,
      shared.showBrowser,
      shared.restAfter,
      shared.repeatRule,
      shared.enabled,
      now,
      id,
    ]
  );
  const updated = await db.get('SELECT * FROM message_schedule_slots WHERE id = ?', [id]);
  if (!updated.series_id && normalizeRepeatRule(updated.repeat_rule) !== 'none') {
    await materializeSeriesOccurrences(db, updated);
  }
  return rowToSlot(updated);
}

async function deleteSlot(id, options = {}) {
  const scope = options.scope === 'series' ? 'series' : 'one';
  const db = await getDB();
  const existing = await db.get('SELECT id, series_id, status FROM message_schedule_slots WHERE id = ?', [id]);
  if (!existing) return false;
  if (existing.status === 'running') {
    throw new Error('Нельзя удалить выполняющийся слот');
  }

  if (scope === 'series') {
    const rootId = existing.series_id || existing.id;
    const result = await db.run(
      `DELETE FROM message_schedule_slots WHERE (id = ? OR series_id = ?) AND status != 'running'`,
      [rootId, rootId]
    );
    return result.changes > 0;
  }

  await db.run('DELETE FROM message_schedule_slots WHERE id = ?', [id]);
  return true;
}

module.exports = {
  startMessageScheduler,
  stopMessageScheduler,
  getNextPendingSlot,
  listSlots,
  createSlot,
  updateSlot,
  deleteSlot,
  getSeriesInfo,
  rowToSlot,
};
