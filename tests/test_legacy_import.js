const fs = require('fs/promises');
const path = require('path');
const { getDB } = require('../backend/lib/db');
const { getRootPath } = require('../backend/lib/utils');

async function test() {
    console.log('🧪 Starting Legacy Import Test...');
    const rootPath = getRootPath();
    const configDir = path.join(rootPath, 'config');
    const dbPath = path.join(configDir, 'database_test_temp.sqlite');

    // 1. Prepare dummy legacy files
    const cityFile = path.join(configDir, 'cityKeywords.txt');
    const nameFile = path.join(configDir, 'names.txt');
    const profilesFile = path.join(configDir, 'profiles.txt');

    console.log('📝 Creating dummy legacy files...');
    await fs.writeFile(cityFile, 'TestCity1\nTestCity2');
    await fs.writeFile(nameFile, 'TestName1\nTestName2');
    await fs.writeFile(profilesFile, 'https://www.instagram.com/test_donor1/\nhttps://www.instagram.com/test_donor2/');

    // 2. Backup and delete current DB
    let dbBackupBody = null;
    try {
        if (await fs.stat(dbPath).catch(() => null)) {
            console.log('📦 Backing up existing database...');
            dbBackupBody = await fs.readFile(dbPath);
            await fs.unlink(dbPath);
        }
    } catch (e) {
        console.error('Error during DB backup:', e);
    }

    try {
        console.log('🚀 Initializing DB (should trigger import)...');
        const db = await getDB();

        // 3. Verify data in DB
        console.log('🧐 Verifying imported data...');
        const cities = await db.all("SELECT value FROM keywords WHERE type = 'city'");
        const names = await db.all("SELECT value FROM keywords WHERE type = 'name'");
        const donors = await db.all("SELECT url FROM urls WHERE type = 'donor'");

        console.log('Found cities:', cities.map(c => c.value));
        console.log('Found names:', names.map(n => n.value));
        console.log('Found donors:', donors.map(d => d.url));

        const success = cities.length === 2 && names.length === 2 && donors.length === 2;

        if (success) {
            console.log('✅ TEST PASSED: Legacy data successfully imported!');
        } else {
            console.error('❌ TEST FAILED: Data mismatch!');
        }

    } catch (err) {
        console.error('❌ TEST FAILED with error:', err);
    } finally {
        // 4. Cleanup and restore
        console.log('🧹 Cleaning up...');
        await fs.unlink(cityFile).catch(() => { });
        await fs.unlink(nameFile).catch(() => { });
        await fs.unlink(profilesFile).catch(() => { });

        if (dbBackupBody) {
            console.log('📦 Restoring original database...');
            await fs.writeFile(dbPath, dbBackupBody);
        }
    }
}

test();
