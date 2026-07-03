import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { useDialog } from '../context/DialogContext';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 56;
const DRAG_THRESHOLD = 5;
const SNAP_MINUTES = 15;
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const STATUS_LABELS = {
  pending: 'Ожидает',
  running: 'Идёт',
  completed: 'Готово',
  cancelled: 'Отменено',
  missed: 'Пропущено',
  failed: 'Ошибка',
};

const SCHEDULE_PREFS_KEY = 'ig-schedule-slot-prefs';

function loadSchedulePrefs() {
  try {
    const raw = localStorage.getItem(SCHEDULE_PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      count: Math.max(1, parseInt(p.count, 10) || 20),
      cityOnly: !!p.cityOnly,
      likedOnly: !!p.likedOnly,
      showBrowser: !!p.showBrowser,
      restAfter: !!p.restAfter,
      enabled: p.enabled !== false,
    };
  } catch {
    return null;
  }
}

function saveSchedulePrefs(form) {
  if (!form || form.status === 'running') return;
  try {
    localStorage.setItem(
      SCHEDULE_PREFS_KEY,
      JSON.stringify({
        count: Math.max(1, parseInt(form.count, 10) || 20),
        cityOnly: !!form.cityOnly,
        likedOnly: !!form.likedOnly,
        showBrowser: !!form.showBrowser,
        restAfter: !!form.restAfter,
        enabled: form.enabled !== false,
      })
    );
  } catch { /* ignore */ }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toLocalDateInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeInput(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

const WEEKLY_REPEAT_LABELS = {
  0: 'Каждое воскресенье',
  1: 'Каждый понедельник',
  2: 'Каждый вторник',
  3: 'Каждую среду',
  4: 'Каждый четверг',
  5: 'Каждую пятницу',
  6: 'Каждую субботу',
};

function repeatOptionsForDate(dateStr) {
  const d = dateStr ? parseLocalDateTime(dateStr, '12:00') : new Date();
  return [
    { value: 'none', label: 'Не повторять' },
    { value: 'daily', label: 'Каждый день' },
    { value: 'weekly', label: WEEKLY_REPEAT_LABELS[d.getDay()] || 'Каждую неделю' },
    { value: 'weekdays', label: 'Каждый будний день (пн–пт)' },
    { value: 'weekends', label: 'Каждые выходные (сб–вс)' },
  ];
}

function repeatShortLabel(repeatRule, dateStr) {
  if (!repeatRule || repeatRule === 'none') return '';
  const opt = repeatOptionsForDate(dateStr).find((o) => o.value === repeatRule);
  return opt?.label || '';
}

const REPEAT_HORIZON_DAYS = 56;
const REPEAT_MAX_INSTANCES = 40;

function getNextOccurrenceDate(startAtIso, repeatRule) {
  const repeat = repeatRule || 'none';
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

function buildOptimisticRepeatSeries(payload, rootTempId) {
  const repeatRule = payload.repeatRule || 'none';
  const base = {
    title: payload.title,
    count: payload.count,
    cityOnly: payload.cityOnly,
    likedOnly: payload.likedOnly,
    showBrowser: payload.showBrowser,
    restAfter: payload.restAfter,
    repeatRule,
    enabled: payload.enabled,
    status: 'pending',
    sentCount: 0,
    failReason: '',
  };

  const root = {
    id: rootTempId,
    ...base,
    startAt: payload.startAt,
    endAt: payload.endAt,
    seriesId: null,
  };

  if (repeatRule === 'none') return [root];

  const slots = [root];
  const horizonMs = Date.now() + REPEAT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const startMs = new Date(payload.startAt).getTime();
  const endMs = new Date(payload.endAt).getTime();
  const durationMs = endMs - startMs;
  let cursor = payload.startAt;
  let idx = 0;

  while (idx < REPEAT_MAX_INSTANCES) {
    const nextStart = getNextOccurrenceDate(cursor, repeatRule);
    if (!nextStart || nextStart.getTime() > horizonMs) break;
    const nextEnd = new Date(nextStart.getTime() + durationMs);
    slots.push({
      id: rootTempId - idx - 1,
      ...base,
      startAt: nextStart.toISOString(),
      endAt: nextEnd.toISOString(),
      seriesId: rootTempId,
    });
    cursor = nextStart.toISOString();
    idx += 1;
  }
  return slots;
}

function slotsInWeek(allSlots, weekDays) {
  const weekKeys = new Set(weekDays.map((d) => toLocalDateInput(d)));
  return allSlots.filter((s) => weekKeys.has(toLocalDateInput(new Date(s.startAt))));
}

function replaceOptimisticSlots(prev, tempIds, serverSlots) {
  const tempSet = new Set(tempIds);
  const serverStarts = new Set(serverSlots.map((s) => s.startAt));
  return [
    ...prev.filter((s) => !tempSet.has(s.id) && !serverStarts.has(s.startAt)),
    ...serverSlots,
  ];
}

function mergeSeriesSlotsIntoWeek(prev, rootId, serverWeekSlots) {
  const serverIds = new Set(serverWeekSlots.map((s) => s.id));
  const weekKeys = new Set(
    serverWeekSlots.map((s) => toLocalDateInput(new Date(s.startAt)))
  );
  return [
    ...prev.filter((s) => {
      if (serverIds.has(s.id)) return false;
      if (!rootId || (s.id !== rootId && s.seriesId !== rootId)) return true;
      return !weekKeys.has(toLocalDateInput(new Date(s.startAt)));
    }),
    ...serverWeekSlots,
  ];
}

function isSlotInSeries(s, rootId, slotId) {
  if (!rootId) return s.id === slotId;
  return s.id === slotId || s.id === rootId || s.seriesId === rootId;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function snapTopToMinutes(top) {
  const totalMinutes = Math.round(((top / HOUR_HEIGHT) * 60) / SNAP_MINUTES) * SNAP_MINUTES;
  const clamped = Math.max(0, Math.min(24 * 60 - 60, totalMinutes));
  return (clamped / 60) * HOUR_HEIGHT;
}

function topToTime(top) {
  const totalMinutes = Math.round((top / HOUR_HEIGHT) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return { h, m };
}

function slotToMovePayload(slot, day, top) {
  const { h, m } = topToTime(top);
  const startAt = new Date(day);
  startAt.setHours(h, m, 0, 0);
  const endAt = defaultEndTime(startAt);
  return {
    title: slot.title || '',
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    count: slot.count,
    cityOnly: slot.cityOnly,
    likedOnly: slot.likedOnly,
    showBrowser: slot.showBrowser,
    restAfter: slot.restAfter,
    repeatRule: slot.repeatRule || 'none',
    enabled: slot.enabled,
  };
}

function isDayInPast(day, nowMs = Date.now()) {
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart < todayStart;
}

function minAllowedTopForDay(day, nowMs = Date.now()) {
  if (isDayInPast(day, nowMs)) return Infinity;
  const now = new Date(nowMs);
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (dayStart.getTime() > todayStart.getTime()) return 0;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const snappedMinutes = Math.ceil(nowMinutes / SNAP_MINUTES) * SNAP_MINUTES;
  return (Math.min(snappedMinutes, 24 * 60 - 60) / 60) * HOUR_HEIGHT;
}

function clampTopForDay(day, top, nowMs = Date.now()) {
  if (isDayInPast(day, nowMs)) return null;
  const minTop = minAllowedTopForDay(day, nowMs);
  return Math.max(minTop, snapTopToMinutes(top));
}

function isValidDropDayAndTop(day, top, nowMs = Date.now()) {
  const clamped = clampTopForDay(day, top, nowMs);
  if (clamped === null) return false;
  return Math.abs(clamped - snapTopToMinutes(top)) < 0.01;
}

function seriesTimeDelta(originalStartIso, newStartIso) {
  return new Date(newStartIso).getTime() - new Date(originalStartIso).getTime();
}

function shiftSlotTimes(slot, deltaMs) {
  const start = new Date(new Date(slot.startAt).getTime() + deltaMs);
  const end = slot.endAt
    ? new Date(new Date(slot.endAt).getTime() + deltaMs)
    : defaultEndTime(start);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function applySlotMove(slots, slotId, day, top) {
  const { h, m } = topToTime(top);
  const startAt = new Date(day);
  startAt.setHours(h, m, 0, 0);
  const endAt = defaultEndTime(startAt);
  const isoStart = startAt.toISOString();
  const isoEnd = endAt.toISOString();
  return slots.map((s) =>
    s.id === slotId ? { ...s, startAt: isoStart, endAt: isoEnd } : s
  );
}

function applySlotPayload(slots, slotId, payload, serverSlot) {
  const next = serverSlot || {
    title: payload.title,
    startAt: payload.startAt,
    endAt: payload.endAt,
    count: payload.count,
    cityOnly: payload.cityOnly,
    likedOnly: payload.likedOnly,
    showBrowser: payload.showBrowser,
    restAfter: payload.restAfter,
    repeatRule: payload.repeatRule || 'none',
    enabled: payload.enabled,
  };
  return slots.map((s) => (s.id === slotId ? { ...s, ...next } : s));
}

function canDragSlot(slot) {
  return slot.status === 'pending' && slot.enabled;
}

function defaultEndTime(startDate) {
  const end = new Date(startDate);
  end.setHours(end.getHours() + 1);
  return end;
}

function slotTitle(slot) {
  if (slot.title?.trim()) return slot.title.trim();
  return `Рассылка · ${slot.count} шт.`;
}

function formatCountdown(targetIso, nowMs = Date.now()) {
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) return 'скоро';
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `через ${day}д ${hr % 24}ч`;
  if (hr > 0) return `через ${hr}ч ${min % 60}м`;
  if (min > 0) return `через ${min}м ${sec % 60}с`;
  return `через ${sec}с`;
}

function emptyForm(date = new Date(), hour = 9) {
  const start = new Date(date);
  start.setHours(hour, 0, 0, 0);
  const prefs = loadSchedulePrefs();
  return {
    id: null,
    title: '',
    date: toLocalDateInput(start),
    startTime: toLocalTimeInput(start),
    count: prefs?.count ?? 20,
    cityOnly: prefs?.cityOnly ?? false,
    likedOnly: prefs?.likedOnly ?? false,
    showBrowser: prefs?.showBrowser ?? false,
    restAfter: prefs?.restAfter ?? false,
    repeatRule: 'none',
    enabled: prefs?.enabled ?? true,
    status: 'pending',
    sentCount: 0,
    failReason: '',
  };
}

function formFromSlot(slot) {
  const start = new Date(slot.startAt);
  return {
    id: slot.id,
    title: slot.title || '',
    date: toLocalDateInput(start),
    startTime: toLocalTimeInput(start),
    count: slot.count,
    cityOnly: slot.cityOnly,
    likedOnly: slot.likedOnly,
    showBrowser: !!slot.showBrowser,
    restAfter: !!slot.restAfter,
    repeatRule: slot.repeatRule || 'none',
    seriesId: slot.seriesId || null,
    enabled: slot.enabled,
    status: slot.status,
    sentCount: slot.sentCount || 0,
    failReason: slot.failReason || '',
  };
}

function formToPayload(form) {
  const startAt = parseLocalDateTime(form.date, form.startTime);
  const endAt = defaultEndTime(startAt);
  return {
    title: form.title.trim(),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    count: Math.max(1, parseInt(form.count, 10) || 1),
    cityOnly: form.cityOnly,
    likedOnly: form.likedOnly,
    showBrowser: form.showBrowser,
    restAfter: form.restAfter,
    repeatRule: form.repeatRule || 'none',
    enabled: form.enabled,
  };
}

function EventModal({ form, onChange, onSave, onDelete, onClose, saving, nowMs }) {
  const readOnly = form.status === 'running';
  const backdropDown = useRef(false);
  const countdown =
    form.status === 'pending' && form.enabled && form.date && form.startTime
      ? formatCountdown(parseLocalDateTime(form.date, form.startTime).toISOString(), nowMs)
      : null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="app-dialog-backdrop"
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropDown.current && e.target === e.currentTarget) onClose();
        backdropDown.current = false;
      }}
      role="presentation"
    >
      <div
        className="app-dialog modal-card fade-in-up schedule-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <h3 className="app-dialog-title">
          {form.id ? 'Редактировать рассылку' : 'Новая рассылка'}
        </h3>
        {form.id && (
          <div className={`schedule-status-badge status-${form.status}`}>
            {STATUS_LABELS[form.status] || form.status}
            {form.status === 'completed' && form.sentCount > 0 && ` · отправлено ${form.sentCount}`}
            {form.status === 'failed' && form.failReason && ` · ${form.failReason}`}
            {countdown && ` · ${countdown}`}
          </div>
        )}
        {!form.id && countdown && (
          <div className="schedule-status-badge status-pending">{countdown}</div>
        )}

        <div className="schedule-form-grid">
          <label className="schedule-field schedule-field-full">
            <span>Название</span>
            <input
              type="text"
              className="text-input"
              placeholder="Рассылка утром"
              value={form.title}
              disabled={readOnly}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
            />
          </label>

          <label className="schedule-field">
            <span>Дата</span>
            <input
              type="date"
              className="text-input"
              value={form.date}
              disabled={readOnly}
              onChange={(e) => onChange({ ...form, date: e.target.value })}
            />
          </label>

          <label className="schedule-field">
            <span>Время</span>
            <input
              type="time"
              className="text-input"
              value={form.startTime}
              disabled={readOnly}
              onChange={(e) => onChange({ ...form, startTime: e.target.value })}
            />
          </label>

          <label className="schedule-field">
            <span>Кол-во сообщений</span>
            <input
              type="number"
              min={1}
              max={9999}
              className="text-input"
              value={form.count}
              disabled={readOnly}
              onChange={(e) => onChange({ ...form, count: e.target.value })}
            />
          </label>

          <label className="schedule-field">
            <span>Повтор</span>
            <select
              className="text-input"
              value={form.repeatRule || 'none'}
              disabled={readOnly}
              onChange={(e) => onChange({ ...form, repeatRule: e.target.value })}
            >
              {repeatOptionsForDate(form.date).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <div className="schedule-field schedule-checks">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.cityOnly}
                disabled={readOnly}
                onChange={(e) => onChange({ ...form, cityOnly: e.target.checked })}
              />
              Только город
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.likedOnly}
                disabled={readOnly}
                onChange={(e) => onChange({ ...form, likedOnly: e.target.checked })}
              />
              Только лайки
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.showBrowser}
                disabled={readOnly}
                onChange={(e) => onChange({ ...form, showBrowser: e.target.checked })}
              />
              Показывать браузер
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.restAfter}
                disabled={readOnly}
                onChange={(e) => onChange({ ...form, restAfter: e.target.checked })}
              />
              Отдохнуть после
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.enabled}
                disabled={readOnly}
                onChange={(e) => onChange({ ...form, enabled: e.target.checked })}
              />
              Включено
            </label>
          </div>
        </div>

        <div className="app-dialog-actions">
          {form.id && !readOnly && (
            <button type="button" className="btn-primary btn-danger btn-sm" onClick={onDelete} disabled={saving}>
              Удалить
            </button>
          )}
          <div className="schedule-modal-actions-right">
            <button type="button" className="btn-primary btn-ghost btn-sm" onClick={onClose}>
              Закрыть
            </button>
            {!readOnly && (
              <button type="button" className="btn-primary btn-sm" onClick={onSave} disabled={saving}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScheduleTab({ authFetch }) {
  const { confirm, choose } = useDialog();
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dragState, setDragState] = useState(null);
  const [dragSession, setDragSession] = useState(0);
  const gridRef = useRef(null);
  const daysGridRef = useRef(null);
  const dragStateRef = useRef(null);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const weekStart = useMemo(() => startOfWeek(cursorDate), [cursorDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const range = useMemo(() => {
    const from = weekStart;
    const to = addDays(weekStart, 7);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [weekStart]);

  const fetchSlots = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      const res = await authFetch(`/api/schedule/slots?${qs}`);
      const data = await res.json();
      if (data.success) setSlots(data.slots || []);
      return data.success ? data.slots || [] : null;
    } catch {
      toast.error('Не удалось загрузить расписание');
      return null;
    } finally {
      setLoading(false);
    }
  }, [authFetch, range]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/schedule/status');
      const data = await res.json();
      if (data.success) setScheduleStatus(data);
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => {
    setLoading(true);
    fetchSlots();
  }, [fetchSlots]);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (scheduleStatus?.massMessaging?.running) {
      fetchSlots();
    }
  }, [scheduleStatus?.massMessaging?.running, fetchSlots]);

  useEffect(() => {
    if (!gridRef.current) return;
    const now = new Date();
    if (isSameDay(now, cursorDate) || weekDays.some((d) => isSameDay(d, now))) {
      const scrollTop = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
      gridRef.current.scrollTop = scrollTop;
    }
  }, [weekDays, cursorDate]);

  const slotsByDay = useMemo(() => {
    const map = new Map();
    for (const slot of slots) {
      const d = new Date(slot.startAt);
      const key = toLocalDateInput(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(slot);
    }
    return map;
  }, [slots]);

  const fetchSeriesInfo = useCallback(
    async (slotId) => {
      const res = await authFetch(`/api/schedule/slots/${slotId}/series`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Не удалось проверить серию');
      return data;
    },
    [authFetch]
  );

  const askSeriesScope = useCallback(
    async (slotId, action) => {
      const info = await fetchSeriesInfo(slotId);
      if (!info.needsScopeChoice) return { scope: 'one', info };

      const message = info.hasRelated
        ? `Найдено ${info.relatedCount} связанн${info.relatedCount === 1 ? 'ое' : 'ых'} повторени${info.relatedCount === 1 ? 'е' : info.relatedCount < 5 ? 'я' : 'й'}. Применить только к этому событию или ко всей серии?`
        : 'Это повторяющееся событие. Применить только к этому событию или ко всей серии?';

      const scope = await choose({
        title: action === 'delete' ? 'Удалить событие' : 'Сохранить изменения',
        message,
        choices: [
          { id: 'one', label: 'Только это событие' },
          {
            id: 'series',
            label: 'Все связанные',
            variant: action === 'delete' ? 'danger' : undefined,
          },
        ],
      });
      return { scope, info };
    },
    [choose, fetchSeriesInfo]
  );

  const applySeriesOptimistic = (prev, slotId, payload, seriesInfo, originalSlot) => {
    const rootId = seriesInfo?.rootId;
    const deltaMs = originalSlot
      ? seriesTimeDelta(originalSlot.startAt, payload.startAt)
      : 0;
    return prev.map((s) => {
      if (!isSlotInSeries(s, rootId, slotId)) return s;
      if (s.id === slotId) {
        return {
          ...s,
          ...payload,
          startAt: payload.startAt,
          endAt: payload.endAt,
        };
      }
      const shifted = deltaMs ? shiftSlotTimes(s, deltaMs) : { startAt: s.startAt, endAt: s.endAt };
      return {
        ...s,
        title: payload.title,
        count: payload.count,
        cityOnly: payload.cityOnly,
        likedOnly: payload.likedOnly,
        showBrowser: payload.showBrowser,
        restAfter: payload.restAfter,
        repeatRule: payload.repeatRule,
        enabled: payload.enabled,
        startAt: shifted.startAt,
        endAt: shifted.endAt,
      };
    });
  };

  const openCreate = (date, hour) => {
    setModal(emptyForm(date, hour));
  };

  const handleModalChange = useCallback((next) => {
    setModal(next);
    saveSchedulePrefs(next);
  }, []);

  const openEdit = (slot, e) => {
    e?.stopPropagation();
    setModal(formFromSlot(slot));
  };

  const getDayFromClientX = useCallback(
    (clientX) => {
      const cols = daysGridRef.current?.querySelectorAll('.schedule-day-col');
      if (!cols?.length) return null;
      for (let i = 0; i < cols.length; i++) {
        const r = cols[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) return weekDays[i];
      }
      return null;
    },
    [weekDays]
  );

  const persistSlotMove = useCallback(
    async (slot, day, top, scope = 'one', seriesInfo = null) => {
      const clampedTop = clampTopForDay(day, top);
      if (clampedTop === null || !isValidDropDayAndTop(day, top)) {
        toast.error('Нельзя перенести в прошлое');
        return;
      }

      const movePayload = slotToMovePayload(slot, day, clampedTop);
      let snapshot = null;
      setSlots((prev) => {
        snapshot = prev;
        if (scope === 'series' && seriesInfo?.rootId) {
          const originalSlot = prev.find((s) => s.id === slot.id);
          return applySeriesOptimistic(prev, slot.id, movePayload, seriesInfo, originalSlot);
        }
        return applySlotMove(prev, slot.id, day, clampedTop);
      });

      try {
        const payload = { ...movePayload, scope };
        const res = await authFetch(`/api/schedule/slots/${slot.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Ошибка перемещения');
        if (scope === 'series' && data.seriesSlots?.length) {
          const inWeek = slotsInWeek(data.seriesSlots, weekDays);
          setSlots((prev) => mergeSeriesSlotsIntoWeek(prev, seriesInfo?.rootId, inWeek));
        } else if (scope === 'series') {
          fetchSlots();
        } else if (data.slot) {
          setSlots((prev) => prev.map((s) => (s.id === slot.id ? data.slot : s)));
        }
        fetchStatus();
      } catch (e) {
        if (snapshot) setSlots(snapshot);
        toast.error(e.message || 'Не удалось перенести слот');
      }
    },
    [authFetch, fetchSlots, fetchStatus, weekDays]
  );

  const handleEventMouseDown = (e, slot, day, top) => {
    if (!canDragSlot(slot)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragSession((n) => n + 1);
    setDragState({
      slot,
      originDay: day,
      day,
      originTop: top,
      currentTop: top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const onMove = (e) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const dy = e.clientY - ds.startY;
      const dx = Math.abs(e.clientX - ds.startX);
      if (!ds.moved && Math.abs(dy) < DRAG_THRESHOLD && dx < DRAG_THRESHOLD) return;

      const day = getDayFromClientX(e.clientX) || ds.day;
      const validDay = isDayInPast(day) ? ds.day : day;
      const col = daysGridRef.current?.querySelector(`[data-day="${toLocalDateInput(validDay)}"]`);
      let nextTop = ds.originTop + dy;
      if (col) {
        const rect = col.getBoundingClientRect();
        const relY = e.clientY - rect.top + (gridRef.current?.scrollTop || 0);
        nextTop = snapTopToMinutes(relY - (HOUR_HEIGHT - 4) / 2);
      } else {
        nextTop = snapTopToMinutes(nextTop);
      }
      const clamped = clampTopForDay(validDay, nextTop);
      if (clamped !== null) nextTop = clamped;

      setDragState((prev) =>
        prev ? { ...prev, moved: true, day: validDay, currentTop: nextTop } : null
      );
    };

    const onUp = (e) => {
      if (e.button !== 0) return;
      const ds = dragStateRef.current;
      if (!ds) return;
      if (!ds.moved) {
        setDragState(null);
        openEdit(ds.slot, e);
        return;
      }
      const { day, currentTop: top, slot } = ds;
      if (!isValidDropDayAndTop(day, top)) {
        setDragState(null);
        toast.error('Нельзя перенести в прошлое');
        return;
      }
      setDragState(null);
      void (async () => {
        try {
          const picked = await askSeriesScope(slot.id, 'save');
          if (!picked.scope) return;
          persistSlotMove(slot, day, top, picked.scope, picked.info);
        } catch (err) {
          toast.error(err.message || 'Ошибка');
        }
      })();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragSession, Boolean(dragState), getDayFromClientX, persistSlotMove, askSeriesScope]);

  const handleSave = async () => {
    if (!modal) return;
    const payload = formToPayload(modal);
    if (new Date(payload.startAt).getTime() < Date.now()) {
      toast.error('Нельзя поставить слот в прошлое');
      return;
    }

    saveSchedulePrefs(modal);

    const isEdit = !!modal.id;
    let scope = 'one';
    let seriesInfo = null;

    if (isEdit) {
      try {
        const picked = await askSeriesScope(modal.id, 'save');
        scope = picked.scope;
        seriesInfo = picked.info;
        if (!scope) return;
      } catch (e) {
        toast.error(e.message || 'Ошибка');
        return;
      }
    }

    const tempId = -Date.now();
    const optimisticSlots = isEdit ? [] : buildOptimisticRepeatSeries(payload, tempId);
    const tempIds = optimisticSlots.map((s) => s.id);
    let snapshot = null;

    setModal(null);
    setSlots((prev) => {
      snapshot = prev;
      if (isEdit) {
        if (scope === 'series' && seriesInfo) {
          const originalSlot = prev.find((s) => s.id === modal.id);
          return applySeriesOptimistic(prev, modal.id, payload, seriesInfo, originalSlot);
        }
        return applySlotPayload(prev, modal.id, payload);
      }
      return [...prev, ...optimisticSlots];
    });

    try {
      const url = isEdit ? `/api/schedule/slots/${modal.id}` : '/api/schedule/slots';
      const body = isEdit ? { ...payload, scope } : payload;
      const res = await authFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Ошибка сохранения');

      if (!isEdit && data.seriesSlots?.length) {
        const inWeek = slotsInWeek(data.seriesSlots, weekDays);
        setSlots((prev) => replaceOptimisticSlots(prev, tempIds, inWeek));
      } else if (isEdit && scope === 'series' && data.seriesSlots?.length) {
        const inWeek = slotsInWeek(data.seriesSlots, weekDays);
        setSlots((prev) => mergeSeriesSlotsIntoWeek(prev, seriesInfo?.rootId, inWeek));
      } else if (scope === 'series') {
        await fetchSlots();
      } else if (data.slot) {
        setSlots((prev) => {
          if (isEdit) return prev.map((s) => (s.id === modal.id ? data.slot : s));
          return replaceOptimisticSlots(prev, tempIds, [data.slot]);
        });
      }
      fetchStatus();
    } catch (e) {
      if (snapshot) setSlots(snapshot);
      toast.error(e.message || 'Ошибка сохранения');
    }
  };

  const handleDelete = async () => {
    if (!modal?.id) return;

    let scope = 'one';
    let seriesInfo = null;
    try {
      const picked = await askSeriesScope(modal.id, 'delete');
      scope = picked.scope;
      seriesInfo = picked.info;
      if (!scope) return;
    } catch (e) {
      toast.error(e.message || 'Ошибка');
      return;
    }

    if (!seriesInfo?.needsScopeChoice) {
      const ok = await confirm({
        title: 'Удалить слот?',
        message: 'Рассылка будет удалена из расписания.',
        variant: 'danger',
        confirmText: 'Удалить',
      });
      if (!ok) return;
    }

    const deletedId = modal.id;
    let snapshot = null;

    setModal(null);
    setSlots((prev) => {
      snapshot = prev;
      if (scope === 'series' && seriesInfo) {
        const rootId = seriesInfo.rootId;
        return prev.filter((s) => s.id !== rootId && s.seriesId !== rootId);
      }
      return prev.filter((s) => s.id !== deletedId);
    });

    try {
      const qs = scope === 'series' ? '?scope=series' : '';
      const res = await authFetch(`/api/schedule/slots/${deletedId}${qs}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      fetchStatus();
      if (scope === 'series') fetchSlots();
    } catch (e) {
      if (snapshot) setSlots(snapshot);
      toast.error(e.message || 'Ошибка удаления');
    }
  };

  const goToday = () => setCursorDate(new Date());
  const goPrev = () => {
    setCursorDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  };
  const goNext = () => {
    setCursorDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  };

  const headerLabel = `${weekDays[0].getDate()} – ${weekDays[6].getDate()} ${MONTH_NAMES[weekDays[6].getMonth()]} ${weekDays[6].getFullYear()}`;

  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes() / 60) * HOUR_HEIGHT;
  const nextCountdown = scheduleStatus?.nextSlot
    ? formatCountdown(scheduleStatus.nextSlot.startAt, nowMs)
    : null;

  return (
    <div className="schedule-tab">
      <div className="schedule-toolbar">
        <div className="schedule-toolbar-left">
          <button type="button" className="btn-primary btn-ghost btn-sm" onClick={goPrev}>‹</button>
          <button type="button" className="btn-primary btn-sm" onClick={goToday}>Сегодня</button>
          <button type="button" className="btn-primary btn-ghost btn-sm" onClick={goNext}>›</button>
          <h2 className="schedule-title">{headerLabel}</h2>
        </div>
        <div className="schedule-toolbar-right">
          {scheduleStatus?.nextSlot && (
            <span className="schedule-next-hint">
              Следующая: {new Date(scheduleStatus.nextSlot.startAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {' · '}{scheduleStatus.nextSlot.count} шт.
              {nextCountdown && <span className="schedule-countdown"> · {nextCountdown}</span>}
            </span>
          )}
          {scheduleStatus?.massMessaging?.running && (
            <span className="schedule-live-badge">
              Рассылка {scheduleStatus.massMessaging.current}/{scheduleStatus.massMessaging.total}
            </span>
          )}
          <button type="button" className="btn-primary btn-sm" onClick={() => openCreate(new Date(), 10)}>+ Слот</button>
        </div>
      </div>

      {loading ? (
        <div className="schedule-loading"><div className="loader-ring" /></div>
      ) : (
        <div className="schedule-week">
          <div className="schedule-week-header">
            <div className="schedule-gutter" />
            {weekDays.map((day) => (
              <div key={day.toISOString()} className={`schedule-day-head${isSameDay(day, now) ? ' today' : ''}`}>
                <span className="schedule-day-name">{DAY_NAMES[(day.getDay() + 6) % 7]}</span>
                <span className="schedule-day-num">{day.getDate()}</span>
              </div>
            ))}
          </div>
          <div className="schedule-week-body" ref={gridRef}>
            <div className="schedule-time-col">
              {HOURS.map((h) => (
                <div key={h} className="schedule-hour-label" style={{ height: HOUR_HEIGHT }}>
                  {pad(h)}:00
                </div>
              ))}
            </div>
            <div className="schedule-days-grid" ref={daysGridRef}>
              {weekDays.map((day) => {
                const key = toLocalDateInput(day);
                const daySlots = slotsByDay.get(key) || [];
                const isDragDay = dragState?.day && toLocalDateInput(dragState.day) === key;
                return (
                  <div
                    key={key}
                    data-day={key}
                    className={`schedule-day-col${isSameDay(day, now) ? ' today' : ''}${isDragDay && dragState?.moved ? ' schedule-day-col-drag-over' : ''}`}
                  >
                    {HOURS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        className="schedule-hour-cell"
                        style={{ height: HOUR_HEIGHT }}
                        aria-label={`Создать слот ${key} ${h}:00`}
                        onClick={() => openCreate(day, h)}
                      />
                    ))}
                    {isSameDay(day, now) && (
                      <div className="schedule-now-line" style={{ top: nowTop }} />
                    )}
                    {dragState?.moved &&
                      dragState.originDay &&
                      toLocalDateInput(dragState.originDay) === key &&
                      toLocalDateInput(dragState.day) !== key && (
                        <div
                          className={`schedule-event status-${dragState.slot.status} schedule-event-ghost`}
                          style={{ top: dragState.originTop, height: HOUR_HEIGHT - 4 }}
                        />
                      )}
                    {dragState?.moved && isDragDay && dragState.slot && (
                      <div
                        className={`schedule-event status-${dragState.slot.status} schedule-event-dragging`}
                        style={{ top: dragState.currentTop, height: HOUR_HEIGHT - 4 }}
                      >
                        <span className="schedule-event-time">
                          {(() => {
                            const { h, m } = topToTime(dragState.currentTop);
                            const d = new Date(day);
                            d.setHours(h, m, 0, 0);
                            return toLocalTimeInput(d);
                          })()}
                        </span>
                        <span className="schedule-event-title">{slotTitle(dragState.slot)}</span>
                        <span className="schedule-event-meta">{dragState.slot.count} сообщ.</span>
                      </div>
                    )}
                    {daySlots
                      .filter((slot) => !(dragState?.moved && dragState.slot?.id === slot.id))
                      .map((slot) => {
                        const start = new Date(slot.startAt);
                        const originTop = (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT;
                        const countdown =
                          slot.status === 'pending' && slot.enabled
                            ? formatCountdown(slot.startAt, nowMs)
                            : null;
                        const repeatHint = repeatShortLabel(slot.repeatRule, toLocalDateInput(start));
                        return (
                          <div
                            key={slot.id}
                            role="button"
                            tabIndex={0}
                            className={`schedule-event status-${slot.status}${slot.enabled ? '' : ' disabled'}${canDragSlot(slot) ? ' schedule-event-draggable' : ''}${slot.repeatRule && slot.repeatRule !== 'none' ? ' schedule-event-repeat' : ''}`}
                            style={{ top: originTop, height: HOUR_HEIGHT - 4 }}
                            onMouseDown={(e) => handleEventMouseDown(e, slot, day, originTop)}
                            onClick={(e) => {
                              if (!canDragSlot(slot)) openEdit(slot, e);
                            }}
                            title={`${slotTitle(slot)} · ${slot.count} шт.${repeatHint ? ` · ${repeatHint}` : ''}${countdown ? ` · ${countdown}` : ''}${canDragSlot(slot) ? ' · перетащите' : ''}`}
                          >
                            <span className="schedule-event-time">
                              {toLocalTimeInput(start)}
                              {repeatHint && <span className="schedule-event-repeat-icon" aria-hidden>↻</span>}
                            </span>
                            <span className="schedule-event-title">{slotTitle(slot)}</span>
                            <span className="schedule-event-meta">
                              {countdown ? countdown : `${slot.count} сообщ.`}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <EventModal
          form={modal}
          onChange={handleModalChange}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
          saving={saving}
          nowMs={nowMs}
        />
      )}
    </div>
  );
}
