const { getDB } = require('../backend/lib/db');

(async () => {
  const db = await getDB();

  // Count profiles completely missing data (no photo AND no followers)
  const fullyEmpty = await db.get(`
        SELECT COUNT(*) as cnt FROM profiles 
        WHERE (photo IS NULL OR photo = '') 
          AND (followers_count IS NULL OR followers_count = 0)
    `);
  console.log(`\nProfiles completely missing data (no photo + no followers): ${fullyEmpty.cnt}`);

  // Get all such profiles
  const all = await db.all(`
        SELECT url, name, username, donor, timestamp FROM profiles 
        WHERE (photo IS NULL OR photo = '') 
          AND (followers_count IS NULL OR followers_count = 0)
        ORDER BY timestamp DESC
    `);
  console.log(`\nAll empty profiles:`);
  for (const p of all) {
    console.log(`  ${p.url} -> donor: ${p.donor || '?'}, timestamp: ${p.timestamp}`);
  }

  await db.close();
})();
