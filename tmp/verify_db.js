const { getDB } = require('../backend/lib/db');

async function test() {
  try {
    console.log('Checking database schema...');
    const db = await getDB();

    // List columns for profiles table
    const profileCols = await db.all('PRAGMA table_info(profiles)');
    const profileNames = profileCols.map((c) => c.name);
    console.log('Profile columns:', profileNames);

    const hasPubs = profileNames.includes('publications_count');
    console.log('Profiles has publications_count:', hasPubs);

    // List columns for donors table
    const donorCols = await db.all('PRAGMA table_info(donors)');
    const donorNames = donorCols.map((c) => c.name);
    console.log('Donor columns:', donorNames);

    const hasDonorPubs = donorNames.includes('publications_count');
    console.log('Donors has publications_count:', hasDonorPubs);

    if (hasPubs && hasDonorPubs) {
      console.log('✅ DB Schema verified!');
    } else {
      console.error('❌ DB Schema verification failed!');
    }
  } catch (err) {
    console.error('Error during verification:', err);
  }
}

test();
