const path = require('path');

/** Корень проекта — dist всегда отсюда: ig-bot/dist/ig-bot.exe */
const PROJECT_ROOT = path.resolve(
  process.env.E2E_PROJECT_ROOT || 'C:/Users/root/Documents/Projects/ig/ig-bot'
);

const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const DIST_EXE = path.join(DIST_DIR, 'ig-bot.exe');

module.exports = { PROJECT_ROOT, DIST_DIR, DIST_EXE };
