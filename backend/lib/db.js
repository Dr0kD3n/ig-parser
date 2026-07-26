'use strict';
const sqlite3_1 = require('sqlite3');
Object.defineProperty(exports, '__esModule', { value: true });
exports.getDB = getDB;

const sqlite_1 = require('sqlite');
const path_1 = require('path');
const promises_1 = require('fs/promises');
const utils_1 = require('./utils');
const DB_PATH =
  process.env.DATABASE_URL ||
  (process.env.APP_ROOT
    ? path_1.join(
      process.env.APP_ROOT,
      'config',
      process.env.NODE_ENV === 'test' ? 'database_test.sqlite' : 'database.sqlite'
    )
    : path_1.join(
      (0, utils_1.getRootPath)(),
      'config',
      process.env.NODE_ENV === 'test' ? 'database_test.sqlite' : 'database.sqlite'
    ));
const CONFIG_DIR = path_1.dirname(DB_PATH);
let dbInstance = null;
let dbInitialization = null;
const resetDB = () => {
  dbInstance = null;
  dbInitialization = null;
};
exports.resetDB = resetDB;
async function getDB() {
  if (dbInstance) return dbInstance;
  if (dbInitialization) return dbInitialization;

  dbInitialization = initializeDB();
  try {
    return await dbInitialization;
  } catch (error) {
    dbInstance = null;
    throw error;
  } finally {
    dbInitialization = null;
  }
}

async function initializeDB() {
  // Обеспечиваем существование папки config если это не :memory:
  if (DB_PATH !== ':memory:') {
    try {
      await promises_1.mkdir(CONFIG_DIR, { recursive: true });
    } catch (e) { }
  }
  dbInstance = await (0, sqlite_1.open)({
    filename: DB_PATH,
    driver: sqlite3_1.Database,
  });
  await dbInstance.run('PRAGMA journal_mode = WAL');
  await dbInstance.run('PRAGMA busy_timeout = 5000');
  await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            name TEXT,
            proxy TEXT,
            cookies TEXT,
            active_parser INTEGER DEFAULT 0,
            active_server INTEGER DEFAULT 0,
            active_index INTEGER DEFAULT 0,
            active_profiles INTEGER DEFAULT 0,
            active_checker INTEGER DEFAULT 0,
            fingerprint TEXT
        );

        CREATE TABLE IF NOT EXISTS keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL, -- 'city', 'niche', 'name'
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL, -- 'history', 'donor'
            url TEXT NOT NULL,
            niche TEXT,
            city TEXT,
            UNIQUE(type, url)
        );

        CREATE TABLE IF NOT EXISTS profiles (
            url TEXT PRIMARY KEY,
            name TEXT,
            username TEXT,
            bio TEXT,
            photo TEXT,
            photo_local TEXT,
            photo_cached_at TEXT,
            photo_status TEXT,
            followers_count INTEGER DEFAULT 0,
            following_count INTEGER DEFAULT 0,
            publications_count INTEGER DEFAULT 0,
            posts_count INTEGER DEFAULT 0,
            donor TEXT,
            vote TEXT, -- 'like', 'dislike'
            tg_status TEXT, -- 'valid', 'invalid', NULL
            dmSent INTEGER DEFAULT 0,
            tgTagged INTEGER DEFAULT 0,
            isInCity INTEGER DEFAULT 0,
            timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS messages_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT,
            username TEXT,
            name TEXT,
            message_text TEXT,
            status TEXT, -- 'sent', 'replied', etc.
            timestamp TEXT
        );


        CREATE TABLE IF NOT EXISTS donors (
            username TEXT PRIMARY KEY,
            name TEXT,
            bio TEXT,
            followers_count INTEGER DEFAULT 0,
            publications_count INTEGER DEFAULT 0,
            posts_count INTEGER DEFAULT 0,
            photo TEXT,
            photo_local TEXT,
            photo_cached_at TEXT,
            photo_status TEXT,
            last_updated TEXT
        );

        CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL -- JSON string of settings
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            is_blocked INTEGER DEFAULT 0,
            reset_token TEXT,
            reset_token_expiry DATETIME,
            last_login DATETIME,
            token_version INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registration_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            is_used INTEGER DEFAULT 0,
            used_by_email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS login_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS checked_searches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            donor_url TEXT NOT NULL,
            search_term TEXT NOT NULL,
            UNIQUE(donor_url, search_term)
        );

        CREATE TABLE IF NOT EXISTS message_schedule_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            start_at TEXT NOT NULL,
            end_at TEXT,
            count INTEGER NOT NULL DEFAULT 20,
            city_only INTEGER DEFAULT 0,
            except_city INTEGER DEFAULT 0,
            liked_only INTEGER DEFAULT 0,
            show_browser INTEGER DEFAULT 0,
            rest_after INTEGER DEFAULT 0,
            repeat_rule TEXT DEFAULT 'none',
            series_id INTEGER,
            enabled INTEGER DEFAULT 1,
            status TEXT DEFAULT 'pending',
            executed_at TEXT,
            sent_count INTEGER DEFAULT 0,
            fail_reason TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS telegram_bot_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            token_ciphertext TEXT NOT NULL,
            bot_id TEXT,
            bot_username TEXT,
            owner_user_id TEXT,
            owner_chat_id TEXT,
            owner_username TEXT,
            owner_first_name TEXT,
            pair_code_hash TEXT,
            pair_code_expires_at TEXT,
            update_offset INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            updated_at TEXT NOT NULL
        );

    `);
  try {
    await dbInstance.exec(`ALTER TABLE message_schedule_slots ADD COLUMN show_browser INTEGER DEFAULT 0`);
  } catch (e) { }
  try {
    await dbInstance.exec(`ALTER TABLE message_schedule_slots ADD COLUMN rest_after INTEGER DEFAULT 0`);
  } catch (e) { }
  try {
    await dbInstance.exec(`ALTER TABLE message_schedule_slots ADD COLUMN repeat_rule TEXT DEFAULT 'none'`);
  } catch (e) { }
  try {
    await dbInstance.exec(`ALTER TABLE message_schedule_slots ADD COLUMN series_id INTEGER`);
  } catch (e) { }
  try {
    await dbInstance.exec(`ALTER TABLE message_schedule_slots ADD COLUMN except_city INTEGER DEFAULT 0`);
  } catch (e) { }
  try {
    await dbInstance.exec(`ALTER TABLE urls ADD COLUMN niche TEXT`);
  } catch (e) { }

  try {
    await dbInstance.exec(`ALTER TABLE urls ADD COLUMN city TEXT`);
  } catch (e) { }

  try {
    await dbInstance.exec(`ALTER TABLE urls ADD COLUMN keyword TEXT`);
  } catch (e) { }

  try {
    await dbInstance.exec(`
      UPDATE urls
      SET keyword = TRIM(city || ' ' || niche)
      WHERE type = 'donor'
        AND (keyword IS NULL OR TRIM(keyword) = '')
        AND (TRIM(COALESCE(city, '')) != '' OR TRIM(COALESCE(niche, '')) != '')
    `);
  } catch (e) { }

  try {
    // Try to drop the former index/constraint if possible, but SQLite doesn't easily drop constraints.
    // We will just try to create a new unique index.
    await dbInstance.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_type_url ON urls(type, url)`);
  } catch (e) { }

  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN tg_status TEXT`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN username TEXT`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN followers_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN publications_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN donor TEXT`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN following_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN posts_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN isInCity INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE donors ADD COLUMN posts_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN fingerprint TEXT`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN local_storage TEXT`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN warmup_score INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }
  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN last_warmup TEXT`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN active_checker INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN warmup_progress INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN warmup_running INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE donors ADD COLUMN publications_count INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    await dbInstance.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore if column already exists
  }

  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN dmSent INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN tgTagged INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN dmError TEXT`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE messages_log ADD COLUMN username TEXT`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE messages_log ADD COLUMN account_id TEXT`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE messages_log ADD COLUMN sender_name TEXT`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN dm_status TEXT`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE messages_log ADD COLUMN donor TEXT`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`ALTER TABLE messages_log ADD COLUMN status_manual INTEGER DEFAULT 0`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`
      UPDATE messages_log SET donor = (
        SELECT LOWER(TRIM(REPLACE(
          SUBSTR(p.donor || ',', 1, INSTR(p.donor || ',', ',') - 1),
          '@', ''
        )))
        FROM profiles p WHERE p.url = messages_log.url
      )
      WHERE donor IS NULL OR donor = ''
    `);
  } catch (e) {
    // Ignore
  }

  for (const table of ['profiles', 'donors']) {
    for (const column of ['photo_local TEXT', 'photo_cached_at TEXT', 'photo_status TEXT']) {
      try {
        await dbInstance.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
      } catch (e) {
        // Ignore
      }
    }
  }


  try {
    await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username)`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_messages_log_timestamp ON messages_log(timestamp DESC)`);
  } catch (e) {
    // Ignore
  }

  try {
    await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_messages_log_donor ON messages_log(donor)`);
  } catch (e) {
    // Ignore
  }

  try {
    const { mergeDuplicateProfiles } = require('./profile-dedup');
    const merged = await mergeDuplicateProfiles(dbInstance);
    if (merged > 0) {
      console.log(`[DEDUP] Объединено групп дублей по username: ${merged}`);
    }
  } catch (e) {
    console.error('[DEDUP] Ошибка merge дублей:', e.message);
  }

  // Seeding removed for security.
  /*
  const adminExists = await dbInstance.get("SELECT * FROM users WHERE role = 'admin'");
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    await dbInstance.run('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [
      'admin@igbot.com',
      hash,
      'admin',
    ]);
  }

  const codeCount = (await dbInstance.get('SELECT count(*) as count FROM registration_codes'))
    .count;
  if (codeCount === 0) {
    await dbInstance.run('INSERT INTO registration_codes (code) VALUES (?)', ['WELCOME']);
  }
  */

  return dbInstance;
}

async function importLegacyData(db) {
  const fs = require('fs/promises');
  const rootPath = (0, utils_1.getRootPath)();

  const imports = [
    { file: 'cityKeywords.txt', type: 'city', table: 'keywords' },
    { file: 'cityBlacklist.txt', type: 'city_blacklist', table: 'keywords' },
    { file: 'wordBlacklist.txt', type: 'word_blacklist', table: 'keywords' },
    { file: 'names.txt', type: 'name', table: 'keywords' },
    { file: 'nicheKeywords.txt', type: 'niche', table: 'keywords' },
    { file: 'profiles.txt', type: 'donor', table: 'urls' },
    { file: 'donors.txt', type: 'donor', table: 'urls' },
  ];

  for (const item of imports) {
    try {
      const filePath = (0, path_1.join)(rootPath, 'config', item.file);
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats) continue;

      // Check if we already have data of this type
      let exists;
      if (item.table === 'keywords') {
        exists = await db.get(`SELECT id FROM keywords WHERE type = ? LIMIT 1`, [item.type]);
      } else {
        exists = await db.get(`SELECT id FROM urls WHERE type = ? LIMIT 1`, [item.type]);
      }

      if (!exists) {
        console.log(`[IMPORT] Found legacy file ${item.file}, importing to ${item.table}...`);
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);

        for (const line of lines) {
          if (item.table === 'keywords') {
            await db.run(`INSERT INTO keywords (type, value) VALUES (?, ?)`, [item.type, line]);
          } else {
            // For URLs, we use normalizeUrl from config or just trim
            // To avoid circular dependency, we'll do basic normalization here
            const normUrl = line.replace(/\/$/, '');
            await db.run(`INSERT OR IGNORE INTO urls (type, url) VALUES (?, ?)`, [
              item.type,
              normUrl,
            ]);
          }
        }
        console.log(`[IMPORT] Successfully imported ${lines.length} items from ${item.file}`);
      }
    } catch (err) {
      console.error(`[IMPORT ERROR] Failed to import ${item.file}:`, err.message);
    }
  }
}
