const db = require('../lib/db');
const state = require('../lib/state');
const config = require('../lib/config');
module.exports = (app) => {
app.post('/api/donors', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'Missing url' });
  }
  try {
    const normUrl = config.normalizeUrl(url);
    const existingDonors = await state.StateManager.loadDonors();
    const collectedUrls = new Set(existingDonors.map(d => config.normalizeUrl(d.url)));

    if (collectedUrls.has(normUrl) || state.StateManager.has(normUrl)) {
      return res.json({ success: false, error: 'Donor already exists or was processed' });
    }

    await state.StateManager.saveDonor(url);
    res.json({ success: true });
  } catch (e) {
    console.error('Error saving donor:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/image-failed', async (req, res) => {
  const { url } = req.body;
  const database = await db.getDB();

  console.log(JSON.stringify(url))

  await database.run(`
      CREATE TABLE IF NOT EXISTS failed_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        created_at TEXT
      )
  `);

  const existingRecord = await database.get(
    `SELECT id FROM failed_images WHERE url = ?`,
    [url]
  );

  if (existingRecord) {
    // Если запись уже есть — возвращаем, что он уже в списке
    return res.json({
      success: true,
      message: 'Image is already in the list',
      alreadyExists: true,
    });
  }

  const currentTimestamp = new Date().toISOString();
  await database.run(
    `INSERT INTO failed_images (url, created_at) VALUES (?, ?)`,
    [url, currentTimestamp]
  );

  return res.json({
    success: true,
    message: 'Failed image successfully added to the list',
    alreadyExists: false,
  });
})

app.get('/api/image-failed/list', async (req, res) => {
  const database = await db.getDB();
  try {
    const allFailedImages = await database.all(`SELECT * FROM failed_images ORDER BY id DESC`);

    res.json({ success: true, data: allFailedImages });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, error: 'Failed to parse failed profiles' });
  }
})

};
