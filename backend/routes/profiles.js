const db = require('../lib/db');
const ctx = require('../lib/server-context');
module.exports = (app) => {
  const { getGirlsCached, invalidateGirlsCache } = ctx;
app.get('/api/girls', async (req, res) => {
  if (ctx.restorePhotosStatus.running) invalidateGirlsCache();
  res.json(await getGirlsCached());
});
app.get('/api/donors-collected', async (req, res) => {
  try {
    const database = await db.getDB();
    const rows = await database.all(
      `SELECT DISTINCT donor FROM profiles WHERE donor IS NOT NULL AND donor != '' ORDER BY donor ASC`
    );
    res.json(rows.map((r) => r.donor));
  } catch (e) {
    res.status(500).json([]);
  }
});
app.get('/api/votes', async (req, res) => {
  const profiles = await getGirlsCached();
  const votes = {};
  profiles?.forEach((p) => {
    if (p.vote) votes[p.url] = p.vote;
  });
  res.json(votes);
});
app.post('/api/vote', async (req, res) => {
  const { url, status } = req.body;
  if (!url || !status) {
    return res.status(400).json({ success: false, error: 'Нет url или status' });
  }
  try {
    const database = await db.getDB();
    await database.run(`UPDATE profiles SET vote = ? WHERE url = ?`, [status, url]);
    invalidateGirlsCache();
    console.log(`[GOLOS] ${status} -> добавлен в профиль: ${url}`);
    res.json({ success: true });
  } catch (e) {
    console.log(`[GOLOS ERROR] Ошибка при голосовании: ${e.message}`);
    res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении' });
  }
});
app.post('/api/profiles/tag-tg', async (req, res) => {
  const { url, tagged } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Нет url' });
  }
  try {
    const database = await db.getDB();
    await database.run(`UPDATE profiles SET tgTagged = ? WHERE url = ?`, [tagged ? 1 : 0, url]);
    invalidateGirlsCache();
    res.json({ success: true });
  } catch (e) {
    console.log(`[TAG TG ERROR] ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/api/profiles/delete', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Нет url' });
  }
  try {
    const database = await db.getDB();
    await database.run(`DELETE FROM profiles WHERE url = ?`, [url]);
    invalidateGirlsCache();
    console.log(`[DELETE] Профиль удален: ${url}`);
    res.json({ success: true });
  } catch (e) {
    console.log(`[DELETE ERROR] Ошибка при удалении профиля: ${e.message}`);
    res.status(500).json({ success: false, error: 'Ошибка сервера при удалении' });
  }
});
};
