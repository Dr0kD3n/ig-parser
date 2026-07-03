# BACKEND | scoped

STACK: Node.js | Express | SQLite | routes in `backend/routes/`

## API (grep если split ещё не применён)

| Method | Path | Модуль |
|--------|------|--------|
| POST | /api/auth/login | routes/auth.js |
| POST | /api/auth/signup | routes/auth.js |
| GET/POST | /api/settings | routes/settings.js |
| GET/POST/DELETE | /api/presets | routes/settings.js |
| PUT | /api/accounts/:id | routes/accounts.js |
| POST | /api/accounts/:id/authorize/* | routes/accounts.js |
| POST | /api/accounts/:id/browser/start | routes/accounts.js |
| POST | /api/accounts/:id/warmup | routes/accounts.js |
| GET | /api/girls | routes/profiles.js |
| GET/POST | /api/donors | routes/profiles.js |
| POST | /api/profiles/* | routes/profiles.js |
| GET/POST | /api/check-telegram* | routes/messaging.js |
| POST | /api/mass-messages/* | routes/messaging.js |
| POST | /api/feedback/* | routes/messaging.js |
| GET | /api/admin/users | routes/admin.js |
| GET/POST | /api/bot/* | routes/admin.js |
| GET | /api/stats | routes/admin.js |
| GET | /api/logs | routes/admin.js |
| GET | /api/live-view | routes/admin.js |

Lib: `lib/db.js`, `lib/state.js`, `lib/mass-messenger.js`, `lib/auth-middleware.js`
