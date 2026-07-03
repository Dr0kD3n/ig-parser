const db = require('../lib/db');
module.exports = (app) => {
app.get('/api/presets', async (req, res) => {
  try {
    const database = await db.getDB();
    const rows = await database.all(`SELECT name, data FROM presets ORDER BY name ASC`);
    res.json(rows.map((r) => ({ name: r.name, data: JSON.parse(r.data) })));
  } catch (e) {
    console.error('Error fetching presets:', e);
    res.status(500).json([]);
  }
});

app.post('/api/presets', async (req, res) => {
  const { name, data } = req.body;
  if (!name || !data) {
    return res.status(400).json({ success: false, error: 'Name and data are required' });
  }
  try {
    const database = await db.getDB();
    await database.run(`INSERT OR REPLACE INTO presets (name, data) VALUES (?, ?)`, [
      name,
      JSON.stringify(data),
    ]);
    res.json({ success: true });
  } catch (e) {
    console.error('Error saving preset:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/presets/:name', async (req, res) => {
  const { name } = req.params;
  try {
    const database = await db.getDB();
    await database.run(`DELETE FROM presets WHERE name = ?`, [name]);
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting preset:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

};
