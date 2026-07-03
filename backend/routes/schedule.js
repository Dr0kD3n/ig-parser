const {
  listSlots,
  createSlot,
  updateSlot,
  deleteSlot,
  getSeriesInfo,
  getNextPendingSlot,
} = require('../lib/message-scheduler');
const { getMassMessengerStatus } = require('../lib/mass-messenger');

module.exports = (app) => {
  app.get('/api/schedule/slots', async (req, res) => {
    try {
      const { from, to } = req.query;
      const slots = await listSlots(from || null, to || null);
      res.json({ success: true, slots });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/schedule/slots', async (req, res) => {
    try {
      const { title, startAt, endAt, count, cityOnly, likedOnly, showBrowser, restAfter, repeatRule, enabled } = req.body || {};
      if (!startAt) {
        return res.status(400).json({ success: false, error: 'startAt обязателен' });
      }
      const created = await createSlot({
        title,
        startAt,
        endAt,
        count: Math.max(1, parseInt(count, 10) || 20),
        cityOnly: !!cityOnly,
        likedOnly: !!likedOnly,
        showBrowser: !!showBrowser,
        restAfter: !!restAfter,
        repeatRule: repeatRule || 'none',
        enabled: enabled !== false,
      });
      res.json({
        success: true,
        slot: created.slot,
        seriesSlots: created.seriesSlots || null,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/schedule/slots/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const scope = req.body?.scope === 'series' ? 'series' : 'one';
      const { scope: _s, ...data } = req.body || {};
      const slot = await updateSlot(id, data, { scope });
      if (!slot) return res.status(404).json({ success: false, error: 'Слот не найден' });
      res.json({ success: true, slot, scope });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  app.get('/api/schedule/slots/:id/series', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const info = await getSeriesInfo(id);
      if (!info) return res.status(404).json({ success: false, error: 'Слот не найден' });
      res.json({ success: true, ...info });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/schedule/slots/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const scope = req.query.scope === 'series' ? 'series' : 'one';
      const ok = await deleteSlot(id, { scope });
      if (!ok) return res.status(404).json({ success: false, error: 'Слот не найден' });
      res.json({ success: true, scope });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  app.get('/api/schedule/status', async (req, res) => {
    try {
      const nextSlot = await getNextPendingSlot();
      const mass = getMassMessengerStatus();
      const secondsUntilStart = nextSlot
        ? Math.max(0, Math.floor((new Date(nextSlot.startAt).getTime() - Date.now()) / 1000))
        : null;
      res.json({
        success: true,
        serverNow: new Date().toISOString(),
        nextSlot,
        secondsUntilStart,
        massMessaging: {
          running: !!mass.running,
          current: mass.current || 0,
          total: mass.total || 0,
          status: mass.status || 'Idle',
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
