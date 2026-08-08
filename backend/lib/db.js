'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getDB = getDB;

const sqlite_1 = require('sqlite');
const path_1 = require('path');
const sqlite3_1 = require(
  process.pkg ? path_1.join(path_1.dirname(process.execPath), 'node_modules', 'sqlite3') : 'sqlite3'
);
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

function quoteIdentifier(identifier) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function ensureColumns(database, table, definitions) {
  const quotedTable = quoteIdentifier(table);
  const existing = new Set(
    (await database.all(`PRAGMA table_info(${quotedTable})`)).map((column) => column.name)
  );
  for (const definition of definitions) {
    const column = definition.trim().split(/\s+/, 1)[0];
    if (existing.has(column)) continue;
    await database.exec(
      `ALTER TABLE ${quotedTable} ADD COLUMN ${quoteIdentifier(column)} ${definition
        .trim()
        .slice(column.length)
        .trim()}`
    );
    existing.add(column);
  }
}

async function initializeDB() {
  // Обеспечиваем существование папки config если это не :memory:
  if (DB_PATH !== ':memory:') {
    await promises_1.mkdir(CONFIG_DIR, { recursive: true });
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

        CREATE TABLE IF NOT EXISTS failed_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE,
            created_at TEXT
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
  await ensureColumns(dbInstance, 'message_schedule_slots', [
    'show_browser INTEGER DEFAULT 0',
    'rest_after INTEGER DEFAULT 0',
    "repeat_rule TEXT DEFAULT 'none'",
    'series_id INTEGER',
    'except_city INTEGER DEFAULT 0',
  ]);
  await ensureColumns(dbInstance, 'urls', ['niche TEXT', 'city TEXT', 'keyword TEXT']);
  await dbInstance.exec(`
    UPDATE urls
    SET keyword = TRIM(city || ' ' || niche)
    WHERE type = 'donor'
      AND (keyword IS NULL OR TRIM(keyword) = '')
      AND (TRIM(COALESCE(city, '')) != '' OR TRIM(COALESCE(niche, '')) != '')
  `);
  await dbInstance.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_type_url ON urls(type, url)`);

  await ensureColumns(dbInstance, 'profiles', [
    'tg_status TEXT',
    'username TEXT',
    'followers_count INTEGER DEFAULT 0',
    'publications_count INTEGER DEFAULT 0',
    'donor TEXT',
    'following_count INTEGER DEFAULT 0',
    'posts_count INTEGER DEFAULT 0',
    'isInCity INTEGER DEFAULT 0',
    'dmSent INTEGER DEFAULT 0',
    'tgTagged INTEGER DEFAULT 0',
    'dmError TEXT',
    'dm_status TEXT',
  ]);
  await ensureColumns(dbInstance, 'donors', [
    'posts_count INTEGER DEFAULT 0',
    'publications_count INTEGER DEFAULT 0',
  ]);
  await ensureColumns(dbInstance, 'accounts', [
    'fingerprint TEXT',
    'local_storage TEXT',
    'warmup_score INTEGER DEFAULT 0',
    'last_warmup TEXT',
    'active_checker INTEGER DEFAULT 0',
    'warmup_progress INTEGER DEFAULT 0',
    'warmup_running INTEGER DEFAULT 0',
  ]);
  await ensureColumns(dbInstance, 'users', ['token_version INTEGER DEFAULT 0']);
  await ensureColumns(dbInstance, 'messages_log', [
    'username TEXT',
    'account_id TEXT',
    'sender_name TEXT',
    'donor TEXT',
    'status_manual INTEGER DEFAULT 0',
    'reply_preview TEXT',
    'reply_at TEXT',
    'reply_kind TEXT',
    'reply_source TEXT',
  ]);

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
  for (const table of ['profiles', 'donors']) {
    await ensureColumns(dbInstance, table, [
      'photo_local TEXT',
      'photo_cached_at TEXT',
      'photo_status TEXT',
    ]);
  }

  const { ANONYMOUS_PHOTO_URL_MARKERS } = require('./photo-cache');
  for (const marker of ANONYMOUS_PHOTO_URL_MARKERS) {
    const pattern = `%${marker.toLowerCase()}%`;
    await dbInstance.run(
      `INSERT OR IGNORE INTO failed_images (url, created_at)
       SELECT url, ? FROM profiles WHERE LOWER(photo) LIKE ?`,
      [new Date().toISOString(), pattern]
    );
    await dbInstance.run(
      `UPDATE profiles
       SET photo = '', photo_local = '', photo_cached_at = NULL, photo_status = 'missing'
       WHERE LOWER(photo) LIKE ?`,
      [pattern]
    );
    await dbInstance.run(
      `UPDATE donors
       SET photo = '', photo_local = '', photo_cached_at = NULL, photo_status = 'missing'
       WHERE LOWER(photo) LIKE ?`,
      [pattern]
    );
  }

  await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username)`);
  await dbInstance.exec(
    `CREATE INDEX IF NOT EXISTS idx_messages_log_timestamp ON messages_log(timestamp DESC)`
  );
  await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_messages_log_donor ON messages_log(donor)`);
  await importLegacyData(dbInstance);

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
