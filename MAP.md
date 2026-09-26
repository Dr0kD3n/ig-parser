# MAP - карта проекта IG Bot

Назначение: быстро выбрать файлы перед чтением или изменением кода. Сначала найти задачу в разделе «Куда идти», затем открыть только указанные файлы и локальный `CLAUDE.md`.

## Правила навигации

- Backend: `backend/CLAUDE.md` -> нужный `backend/routes/*.js` -> вызываемые `backend/lib/*.js`.
- Frontend: `frontend/CLAUDE.md` -> экран в `frontend/src/components/` -> hooks/utils -> профильный CSS.
- `frontend/src/App.jsx` - глобальная оркестрация UI; `backend/server.js` - сборка Express-приложения.
- Не читать как исходники: `backend/public/`, `dist/`, `build/`, `node_modules/`, логи, БД, кэши, `.env`.
- После добавления/переноса файла или ответственности обновлять этот MAP.

## Точки входа

| Файл | Роль | Ключевые функции/связи |
|---|---|---|
| `package.json` | workspaces, общие команды, версия | backend, frontend, внешний auth server |
| `backend/package.json` | CommonJS backend и Windows `pkg` | entrypoint `server.js` |
| `frontend/package.json` | React/Vite frontend | entrypoint `src/main.jsx` |
| `backend/server.js` | Express, middleware, rate limit, логи/SSE, static, lifecycle | `saveLogs`, `debouncedSaveLogsLocal`, `mountRoutes`, scheduler, Telegram bot, tray |
| `backend/routes/index.js` | порядок API | public/auth, `verifyToken`, защищённые routes |
| `frontend/src/main.jsx` | React bootstrap | `DialogProvider`, `App`, `Toaster` |
| `frontend/src/App.jsx` | auth, глобальные данные, вкладки, операции | `App`, status/log hooks, основные экраны |

## Куда идти по задаче

| Задача | Сначала | Затем |
|---|---|---|
| Сбор профилей | `backend/routes/admin.js` | `backend/index.js`, `lib/state.js`, `frontend/src/App.jsx` |
| Поиск доноров | `backend/parser.js` | `lib/donor-relevance.js`, `lib/browser.js` |
| Профили/фильтры | `frontend/src/components/ProfilesTab.jsx` | `utils/profileFilters.js`, `profile.js`, `donor.js` |
| Массовые DM | `backend/routes/messaging.js` | `lib/mass-messenger.js`, `anti-fraud.js`, `send-rate-governor.js` |
| Telegram check | `backend/routes/messaging.js` | `lib/telegram-checker.js`, `tg-batch-checker.js` |
| Telegram-агент | `backend/routes/telegram-bot.js` | `lib/telegram-bot-service.js`, `telegram-command-executor.js`; UI `TelegramAgentSection.jsx` |
| Ответы/лайки | `backend/routes/messaging.js` | `lib/feedback-checker.js`, `feedback-handler.js`, `feedback-check-scheduler.js` |
| Аккаунты/auth | `backend/routes/accounts.js` | `lib/authorizer.js`, `browser.js`, `fingerprint.js`; UI `AccountsSection.jsx` |
| Прогрев/cooldown | `backend/routes/accounts.js` | `lib/warmup.js`, `instagram-activity.js` |
| Настройки | `backend/routes/settings.js` | `lib/config.js`; UI `SettingsTab.jsx`, `components/settings/*` |
| Доноры/категории | `backend/routes/donors.js` | `utils/donorCategories.js`, `DonorsSettingsSection.jsx` |
| Статистика | `backend/routes/admin.js` | `lib/donor-category-stats.js`, `StatisticsTab.jsx` |
| Расписание | `backend/routes/schedule.js` | `lib/message-scheduler.js`, `ScheduleTab.jsx`, `styles/schedule.css` |
| Фото профилей | `backend/routes/public.js`, `accounts.js` | `lib/photo-cache.js`, `photo-restorer.js`, `profile-dedup.js` |
| Auth/JWT | `backend/routes/auth.js` | `lib/auth-controller.js`, `auth-middleware.js`, `auth-config.js` |
| Стили | компонент экрана | один `frontend/src/styles/*`; `index.css` целиком не читать |

## Как устроена система

### Процессы и границы

| Процесс | Где работает | Ответственность | Чем обменивается |
|---|---|---|---|
| React UI | браузер пользователя | формы, фильтры, отображение статусов, команды API | HTTP/JSON, SSE `/api/logs`, изображения `/profile-photos/*` |
| Local API | `backend/server.js` | защищённый API, SQLite, управление workers и браузерами | Express routes, `server-context`, `state` |
| Collector worker | `backend/index.js` | подписчики доноров, анализ профилей, запись результатов | config/DB -> Playwright -> profiles/urls/фото |
| Parser worker | `backend/parser.js` | поиск новых доноров по нишам/городам | keywords/settings -> Instagram search -> donors |
| Checker worker | `backend/checker.js` | проверка валидности Instagram cookies | accounts -> Playwright -> account status |
| Mass messenger | `backend/lib/mass-messenger.js` | выбор профилей и последовательная отправка DM | profiles/settings -> anti-fraud/browser -> messages_log |
| Feedback checker | `backend/lib/feedback-checker.js` | чтение inbox, фиксация reply/like | accounts/messages_log -> Instagram inbox -> DB statuses |
| Scheduler | `backend/lib/message-scheduler.js` | хранение и запуск разовых/повторных задач | message_schedule_slots -> mass messenger |
| Telegram agent | `backend/lib/telegram-bot-service.js` | polling, pairing, удалённые команды | Bot API -> command executor -> local services |

### Основные хранилища состояния

| Состояние | Владелец | Жизненный цикл | Кто читает/меняет |
|---|---|---|---|
| Постоянные данные | SQLite через `backend/lib/db.js` | между запусками | routes, workers, scheduler, statistics |
| Текущий worker/progress/stop flags | `backend/lib/state.js` | один процесс worker | `index.js`, `parser.js`, admin routes |
| Child processes, caches, SSE logs, warmup status | `backend/lib/server-context.js` | один запуск Local API | `server.js`, routes, frontend polling/SSE |
| Статусы массовых DM/TG/feedback | соответствующий service module | один запуск Local API | messaging routes, `useOperationStatuses` |
| Auth token | `frontend/src/App.jsx` + `safeStorage` | browser storage/session | `authFetch`, auth server, protected Local API |
| Настройки UI/операций | `frontend/src/App.jsx` | загружаются из `/api/settings` | Settings UI, запуск workers, filters/messages |
| Фильтры профилей | `usePersistedFilters.js` | localStorage | `ProfilesTab` |

## Основные потоки данных

### Сбор профилей

1. `App.jsx` вызывает `POST /api/bot/start` с типом worker.
2. `routes/admin.js` запускает `index.js` или `parser.js` через `instagram-worker-service.js`/`server-context.botProcesses`.
3. Worker читает settings/accounts/cookies через `config.js`, создаёт Playwright context через `browser.js`.
4. `index.js` обходит доноров, извлекает кандидатов, фильтрует профиль, дедуплицирует через `state.js`/`profile-dedup.js`.
5. Результаты пишутся в SQLite; фото проходят через `photo-cache.js`; прогресс/логи идут в Local API.
6. `App.jsx` обновляет `/api/girls`; `useLogStream` получает SSE; `ProfilesTab` применяет локальные фильтры.

### Массовые сообщения

1. `App.jsx` отправляет `POST /api/mass-messages/start` с фильтрами/лимитом.
2. `routes/messaging.js` валидирует запрос, получает DB и вызывает `startMassMessaging`.
3. `mass-messenger.js` выбирает подходящие профили, исключает дубли/уже отправленные, выбирает аккаунт и сообщение категории.
4. `anti-fraud.js` открывает профиль/чат, имитирует действия, отправляет и проверяет доставку.
5. `send-rate-governor.js` корректирует паузы/лимиты; результат сохраняется в profile/message status.
6. `useOperationStatuses` опрашивает status endpoint; stop выставляет флаг безопасной остановки.

### Проверка ответов

1. UI или `feedback-check-scheduler.js` запускает `/api/feedback/start`.
2. `feedback-checker.js` загружает ожидающие сообщения и аккаунты, открывает inbox.
3. Строки диалогов связываются с username; preview классифицируется как reply/like/ignored.
4. `feedback-handler.js` сохраняет результат; `StatisticsTab` читает `/api/stats` и `/api/stats/messages`.

### Расписание

1. `ScheduleTab.jsx` создаёт/меняет slot через `/api/schedule/slots`.
2. `message-scheduler.js` нормализует repeat rule, материализует серию, хранит строки в `message_schedule_slots`.
3. Scheduler ищет due slot, запускает mass messenger, переводит slot в running/completed/failed/missed.
4. UI отдельно получает slots и scheduler status; drag/drop отправляет новое время/дату.

### Telegram-агент

1. `TelegramAgentSection.jsx` сохраняет token, запускает bot и создаёт pairing code.
2. `telegram-credential-store.js` шифрует token ключом установки.
3. `telegram-bot-service.js` poll-ит updates, проверяет paired chat, разбирает команду.
4. `telegram-command-executor.js` валидирует payload и вызывает разрешённый worker/service.
5. Результат форматируется и отправляется обратно через Bot API.

## Backend: процессы

| Файл | Назначение | Ключевые функции |
|---|---|---|
| `backend/index.js` | основной Instagram worker | `fetchProfileInfo`, `scrollAndCollectUrls`, `analyzeProfile`, `analyzeProfileFast`, `processDonor`, `run` |
| `backend/parser.js` | поиск/оценка доноров | `getCombinedKeywords`, `fetchDonorProfile`, `fetchDonorLocationEvidence`, `searchProfilesInInstagramUi`, `run` |
| `backend/checker.js` | проверка авторизации аккаунтов | `checkAccounts` |
| `backend/restore.js` | CLI восстановления фото | вызывает `photo-restorer` |

## Backend: API routes

Все route-файлы монтируются через `backend/routes/index.js`.

| Файл | API/ответственность |
|---|---|
| `backend/routes/auth.js` | login, signup |
| `backend/routes/public.js` | health, profile photos |
| `backend/routes/admin.js` | bot start/stop/status, skip donor, single DM, logs/live-view, stats |
| `backend/routes/accounts.js` | authorize, browser, warmup, cooldown, restore photos, update account |
| `backend/routes/profiles.js` | girls, donors, votes, Telegram tag, delete profile |
| `backend/routes/donors.js` | сохранение доноров, ошибки изображений |
| `backend/routes/settings.js` | `GET/POST /api/settings` |
| `backend/routes/presets.js` | CRUD `/api/presets` |
| `backend/routes/messaging.js` | Telegram check, mass messages, feedback |
| `backend/routes/schedule.js` | CRUD slots/series, status |
| `backend/routes/telegram-bot.js` | config/start/stop/pair/status агента |
| `backend/routes/proxy.js` | безопасный `/api/proxy-image` |
| `backend/routes/e2e.js` | reset/state только при `E2E_TEST=1` |

### Точные endpoint-группы

| Route-файл | Endpoints | Что вызывает/изменяет |
|---|---|---|
| `auth.js` | `POST /api/auth/login`, `POST /api/auth/signup` | `auth-controller`; rate limit применяется до общей JWT-защиты |
| `public.js` | `GET /api/health`, `GET /profile-photos/:fileName` | health без auth; локальный файл только через разрешённый photo path |
| `admin.js` | `GET /api/logs`, `POST /api/logs/clear`, `GET /api/live-view` | in-memory/SSE logs, screenshot активной page |
| `admin.js` | `GET /api/bot/status`, `POST /api/bot/start`, `/stop`, `/skip-donor` | `botProcesses`, worker service, stop/skip state |
| `admin.js` | `POST /api/dm` | одиночная отправка через `server-context.sendMessageToProfile` |
| `admin.js` | `GET /api/stats`, `/api/stats/messages`, `PATCH /api/stats/messages/:id` | агрегаты и ручная коррекция message status |
| `admin.js` | `GET /api/stats/likes-by-category` | `donor-category-stats` |
| `accounts.js` | `POST /api/accounts/:id/authorize/start`, `/stop`; `GET .../status` | lifecycle `authorizer` |
| `accounts.js` | `POST /api/accounts/:id/browser/start` | browser context для ручной проверки/восстановления auth |
| `accounts.js` | `POST /api/accounts/:id/warmup`, `/instagram-cooldown`; status endpoints | `warmup`, status maps в `server-context` |
| `accounts.js` | `PUT /api/accounts/:id` | account cookies/proxy/fingerprint/settings в DB |
| `accounts.js` | `POST /api/profiles/restore-photos`, `/stop`; `GET .../status` | `photo-restorer`, `restorePhotosStatus` |
| `profiles.js` | `GET /api/girls`, `/api/donors-collected`, `/api/votes` | profile/donor/vote projections из DB/cache |
| `profiles.js` | `POST /api/vote`, `/api/profiles/tag-tg`, `/api/profiles/delete` | меняет profile flags/status или удаляет записи |
| `donors.js` | `POST /api/donors` | нормализует и сохраняет donors, сбрасывает зависимые caches |
| `donors.js` | `POST /api/image-failed`, `GET /api/image-failed/list` | таблица `failed_images` |
| `settings.js` | `GET /api/settings`, `POST /api/settings` | DB settings/accounts; шифрование секретов, fingerprint normalization |
| `presets.js` | `GET/POST /api/presets`, `DELETE /api/presets/:name` | таблица `presets` |
| `messaging.js` | `GET /api/check-telegram` | одиночный `telegram-checker` |
| `messaging.js` | batch TG start/stop/status | `tg-batch-checker`, обновление TG status профилей |
| `messaging.js` | mass messages start/stop/status | `mass-messenger` |
| `messaging.js` | feedback start/stop/status | `feedback-check-scheduler`/`feedback-handler` |
| `schedule.js` | CRUD `/api/schedule/slots`, series/status endpoints | `message-scheduler`, таблица schedule slots |
| `telegram-bot.js` | status/config/start/stop/pair endpoints | `telegram-bot-service`, encrypted credential store |
| `proxy.js` | `GET /api/proxy-image` | проверяет URL, выбирает http/https, ограничивает загрузку изображения |

## SQLite: что хранится

Схема и миграции находятся только в `backend/lib/db.js`; routes не должны создавать таблицы.

| Таблица | Содержимое | Основные владельцы |
|---|---|---|
| `accounts` | Instagram account, cookies, proxy, fingerprint, operational fields | `config.js`, settings/accounts routes, workers |
| `keywords` | поисковые ключи/ниши | parser, settings |
| `urls` | обработанные URL/кандидаты | collector state/worker |
| `profiles` | собранный профиль, donor, Telegram/DM/vote/status, photo refs | collector, profiles routes, messaging, statistics |
| `settings` | key/value настройки приложения | `config.js`, settings route |
| `messages_log` | попытка DM, время, donor, account, итог/feedback | mass messenger, feedback checker, statistics |
| `donors` | donor URL/username, keyword/niche/city metadata | parser, donors route, category resolution |
| `failed_images` | изображения, которые не удалось получить | donors route, photo recovery UI |
| `presets` | сохранённые пользовательские пресеты | presets route |
| `users` | локальные auth-пользователи | auth controller |
| `registration_codes` | допустимые коды регистрации | auth controller/admin auth system |
| `login_logs` | аудит попыток входа | auth controller |
| `checked_searches` | уже выполненные пары donor/search | parser/state, защита от повторов |
| `message_schedule_slots` | start/end, repeat rule, status, payload задачи | message scheduler/schedule route |
| `telegram_bot_config` | настройки агента, pairing metadata, encrypted token | Telegram bot service/credential store |

## Backend: библиотеки

| Файл | Назначение | Ключевые функции/экспорты |
|---|---|---|
| `backend/lib/server-context.js` | общий runtime Express/worker | caches, session, logs/SSE, selectors |
| `backend/lib/state.js` | browser/context/page, progress, stop flags | runtime state helpers |
| `backend/lib/db.js` | SQLite singleton, схема, миграции | `getDB`, `initializeDB`, `ensureColumns`, `importLegacyData` |
| `backend/lib/config.js` | settings, cookies, proxies, accounts | `getProxy`, `getCookies`, `getSetting`, `getAllAccounts` |
| `backend/lib/browser.js` | Playwright context, fingerprint, live view | `createBrowserContext`, `applyFingerprint`, `startLiveView`, `checkLoginPage` |
| `backend/lib/fingerprint.js` | browser fingerprint | `generateFingerprint` |
| `backend/lib/ig-selectors.js` | Instagram selectors | selector constants |
| `backend/lib/instagram-overlays.js` | блокирующие Instagram overlays | `dismissBlockingModals`, `watchBlockingModals` |
| `backend/lib/instagram-activity.js` | блокировка параллельных IG-операций | `tryAcquireInstagramActivity`, `releaseInstagramActivity`, `getInstagramActivity` |
| `backend/lib/instagram-worker-service.js` | отдельный worker-процесс | `createInstagramWorkerService` |
| `backend/lib/authorizer.js` | интерактивная авторизация аккаунта | `startAuthorization`, `stopAuthorization`, `getAuthorizationStatus` |
| `backend/lib/warmup.js` | прогрев и Instagram cooldown | `startWarmup`, `stopWarmup`, `startInstagramCooldown` |
| `backend/lib/anti-fraud.js` | человекоподобная навигация, безопасная отправка | `navigateViaSearch`, `openProfileDM`, `submitMessage`, `verifyMessageDelivered`, `detectChatHistory` |
| `backend/lib/mass-messenger.js` | очередь массовых DM | `sendMessageToProfile`, `startMassMessaging`, `stopMassMessaging`, `getMassMessengerStatus` |
| `backend/lib/send-rate-governor.js` | динамические лимиты отправки | `createSendRateGovernor` |
| `backend/lib/message-scheduler.js` | повторяющиеся слоты и запуск DM | `startMessageScheduler`, `listSlots`, `createSlot`, `updateSlot`, `deleteSlot` |
| `backend/lib/feedback-checker.js` | inbox, ответы и лайки | `checkFeedback`, `checkAccount`, `getCheckerStatus`, `stopChecker` |
| `backend/lib/feedback-handler.js` | фасад feedback checker | `checkFeedback`, `getCheckerStatus`, `stopChecker` |
| `backend/lib/feedback-check-scheduler.js` | периодический feedback check | `startFeedbackCheckScheduler`, `runFeedbackCheckNow`, `getFeedbackCheckStatus` |
| `backend/lib/telegram-checker.js` | проверка Telegram-профиля | `parseTelegramPage`, `fetchTelegramPage`, `checkTelegramProfile` |
| `backend/lib/tg-batch-checker.js` | batch Telegram check | `startTgBatchCheck`, `stopTgBatchCheck`, `getTgBatchStatus` |
| `backend/lib/telegram-bot-service.js` | polling Bot API, pairing, команды | `telegramRequest`, `parseCommand`, `createTelegramBotService` |
| `backend/lib/telegram-command-executor.js` | исполнение команд агента | `validateWorkerType`, `assertPayload`, `createTelegramCommandExecutor` |
| `backend/lib/telegram-credential-store.js` | шифрованный bot token | `encryptTelegramToken`, `decryptTelegramToken` |
| `backend/lib/encryption.js` | versioned encryption | `encrypt`, `encryptSafe`, `decrypt` |
| `backend/lib/profile-dedup.js` | объединение дублей/статусов | `mergeProfileRecords`, `dedupeProfilesForMessaging`, `markDmSentByUsername` |
| `backend/lib/donor-relevance.js` | aliases, blacklist, ranking | `splitAliases`, `matchesKeyword`, `rankDonorCandidates`, `evaluateDonor` |
| `backend/lib/donor-category-stats.js` | статистика по категориям | `getLikesByCategory`, `getDonorMessageStats`, `extractPrimaryDonor` |
| `backend/lib/photo-cache.js` | локальный кэш фото | `findCachedPhoto`, `cacheProfilePhoto`, `cacheProfilePhotoFromPage`, `getLocalPhotoPath` |
| `backend/lib/photo-restorer.js` | batch-восстановление фото | `restorePhotos`, `stopRestorePhotos` |
| `backend/lib/operation-events.js` | события долгих операций | `emitOperationEvent` |
| `backend/lib/error-handler.js` | Express/process error handlers | `handleError`, `expressErrorHandler`, `setupProcessHandlers` |
| `backend/lib/errors.js` | классы ошибок | `AppError`, `BrowserError` |
| `backend/lib/logger.js` | файловый логгер | `log`, `info`, `warn`, `error`, `debug` |
| `backend/lib/reporter.js` | crash report/screenshot | `saveCrashReport` |
| `backend/lib/utils.js` | path/time/network helpers | `getRootPath`, wait/random/URL helpers |
| `backend/lib/auth-controller.js` | signup/login, bcrypt/JWT | `signup`, `login` |
| `backend/lib/auth-middleware.js` | local/remote JWT, admin guard | `verifyRemoteToken`, `verifyToken`, `isAdmin` |
| `backend/lib/auth-config.js` | постоянный JWT secret | `loadJwtSecret` |
| `backend/lib/updater.js` | обновление приложения | updater exports |
| `backend/lib/windows-tray.js` | tray, autostart, shutdown | `startWindowsTray`, `createAutostartCommand`, `createTrayScript` |

### Контракты ключевых backend-модулей

#### `backend/lib/state.js`

- Держит множества `processed`, `processedDonors`, `checkedSearches`, `knownUsernames` для быстрого исключения повторов во время worker-run.
- `has/add` работают с URL профилей; `hasDonor/addDonor` - с донорами; `isChecked/markChecked` - с парой donor + search term.
- Синхронизирует часть состояния с SQLite, поэтому прямое изменение внутренних Set обходит persistence.
- `resultsCache` ускоряет lookup текущего запуска; deferred photo queue ограничивает параллельные загрузки фото.

#### `backend/lib/server-context.js`

- Связывает routes с долгоживущими ресурсами Local API: child processes, SSE emitter, historical logs, caches, warmup/cooldown/restore statuses.
- `getSettings` собирает API-представление настроек; `getGirlsCached` возвращает profiles projection; `invalidateGirlsCache` обязателен после изменения профилей.
- `refreshSession` меняет session id для клиентов; `broadcastLog` пишет в buffer и отправляет SSE.
- Это composition layer. Новую бизнес-логику добавлять в профильный lib, наружу выставлять узкий wrapper.

#### `backend/index.js`

| Функция | Вход | Результат/эффект |
|---|---|---|
| `getDynamicConfig` | DB settings | нормализованный runtime config worker |
| `fetchProfileInfo` | Playwright page, username | Instagram profile metadata |
| `scrollAndCollectUrls` | page/context, limits | уникальные candidate profile URLs |
| `analyzeProfile` | context, URL, config, donor | полная проверка filters + сохранение подходящего profile |
| `analyzeProfileFast` | те же данные, optional API page | дедуплицированная быстрая проверка с in-flight Map |
| `processDonor` | donor URL, config | обход подписчиков/кандидатов одного донора |
| `run` | process env + DB config | полный lifecycle worker, progress, cleanup, exit code |

#### `backend/parser.js`

| Функция | Ответственность |
|---|---|
| `getCombinedKeywords` | строит поисковые фразы из cities + niches |
| `fetchDonorProfile` | получает donor metadata через Instagram data/page |
| `fetchDonorProfileFromUi` | fallback через видимый Instagram UI |
| `fetchDonorLocationEvidence` | собирает признаки города/региона |
| `collectSearchPanelCandidates` | извлекает результаты панели поиска |
| `searchProfilesInInstagramUi` | выполняет поиск, ranking и отбор кандидатов |
| `run` | распределяет запросы, исключает checked searches, сохраняет donors |

#### Messaging-слой

| Модуль | Получает | Гарантирует/изменяет |
|---|---|---|
| `mass-messenger.js` | DB, settings, profiles, account, progress callback | один активный run, stop flag, DM statuses, progress snapshot |
| `anti-fraud.js` | Playwright page, username, message, session | навигация с паузами, правильный chat scope, одна проверенная отправка |
| `send-rate-governor.js` | outcomes/reasons отправок | адаптивная пауза и решение продолжать/остановить account run |
| `feedback-checker.js` | accounts + ожидающие message rows | inbox scan, reply/like classification, DB updates |
| `feedback-check-scheduler.js` | interval/settings/manual trigger | не допускает наложения runs, планирует следующий запуск |
| `message-scheduler.js` | slot CRUD + clock tick | repeat materialization, due-run, конечный slot status |

#### Telegram-слой

| Модуль | Не путать с | Ответственность |
|---|---|---|
| `telegram-checker.js` | Telegram bot | проверяет наличие публичного username/profile у Instagram-профиля |
| `tg-batch-checker.js` | одиночный checker | concurrency pool, progress, stop, сохранение TG status |
| `telegram-bot-service.js` | profile checker | управляет самим ботом удалённого управления: token, polling, pairing, replies |
| `telegram-command-executor.js` | parser текста команды | разрешает конкретные операции и проверяет payload |
| `telegram-credential-store.js` | общий `encryption.js` | installation key и bot-token-specific encryption wrapper |

## Frontend: экраны

| Файл | Назначение | Ключевые функции/компоненты |
|---|---|---|
| `frontend/src/components/AuthPage.jsx` | вход/регистрация | `AuthPage`, `validateFields`, `mapServerError` |
| `frontend/src/components/ProfilesTab.jsx` | профили, фильтры, bulk actions | `ProfilesTab`, `getPrimaryDonorUsername`, `getProfileDonorCategory` |
| `frontend/src/components/ControlsTab.jsx` | worker, логи, live view | `ControlsTab`, `groupLogs` |
| `frontend/src/components/StatisticsTab.jsx` | статистика, сортировка, пагинация | `StatisticsTab`, `sortRows`, `filterBySentCount`, `TablePagination` |
| `frontend/src/components/ScheduleTab.jsx` | календарь, drag/drop, series editor | `ScheduleTab`, `EventModal`, `applySlotMove`, `formToPayload` |
| `frontend/src/components/SettingsTab.jsx` | shell настроек, загрузка/сохранение | `SettingsTab` |
| `frontend/src/components/DonorInfo.jsx` | информация о доноре | `DonorInfo`, `formatDonorSearchMeta` |
| `frontend/src/components/Icons.jsx` | локальные SVG | icon exports |

### Settings UI

| Файл | Назначение | Компоненты/функции |
|---|---|---|
| `frontend/src/components/settings/AccountsSection.jsx` | аккаунты, cookies, proxy, auth/warmup | `AccountsSection` |
| `frontend/src/components/settings/DonorsSettingsSection.jsx` | доноры, categories, bundles, сообщения | `DonorsSettingsSection` |
| `frontend/src/components/settings/DonorsListEditor.jsx` | список доноров | `DonorsListEditor` |
| `frontend/src/components/settings/KeywordCategoriesTable.jsx` | categories/bundles | `KeywordCategoriesTable` |
| `frontend/src/components/settings/CategoryRowExpand.jsx` | раскрытая категория | `CategoryRowExpand` |
| `frontend/src/components/settings/DiscoveredKeywords.jsx` | нераспределённые keywords | `DiscoveredKeywords` |
| `frontend/src/components/settings/MessagesListEditor.jsx` | варианты сообщений | `MessagesListEditor`, `normalizeMessages` |
| `frontend/src/components/settings/NichePresetsSection.jsx` | CRUD ниш/keywords | `NichePresetsSection`, `NicheItemEditor` |
| `frontend/src/components/settings/TelegramAgentSection.jsx` | token, pairing, статус агента | `TelegramAgentSection`, `readResponse` |
| `frontend/src/components/settings/DebouncedLinesTextarea.jsx` | textarea с debounce | `DebouncedLinesTextarea` |
| `frontend/src/components/settings/SkeletonSettings.jsx` | skeleton загрузки | `SkeletonSettings` |
| `frontend/src/components/settings/ChangesSection.jsx` | changelog | `RELEASES`, `ChangesSection` |

## Frontend: hooks, utils, constants

| Файл | Назначение | Ключевые экспорты |
|---|---|---|
| `frontend/src/context/DialogContext.jsx` | общий dialog | `DialogProvider`, `AppDialog`, `useDialog` |
| `frontend/src/hooks/useLogStream.js` | SSE с reconnect/buffer | `useLogStream`, `appendSseEvents` |
| `frontend/src/hooks/useOperationStatuses.js` | polling операций | `useOperationStatuses`, `useStatusPolling` |
| `frontend/src/hooks/usePersistedFilters.js` | фильтры в localStorage | `usePersistedFilters` |
| `frontend/src/hooks/useCollapsed.js` | persistent collapsed state | `useCollapsed` |
| `frontend/src/utils/profile.js` | Telegram/bio/photo helpers | `getTelegramUsername`, `getTelegramUrl`, `parseSmartBio`, `getProfilePhotoSrc` |
| `frontend/src/utils/profileFilters.js` | pipeline фильтров | `filterProfiles` |
| `frontend/src/utils/donor.js` | donor URL/username normalization | donor helpers |
| `frontend/src/utils/donorCategories.js` | categories/bundles, миграция, статистика, сообщения | `ensureDefaultDonorGroups`, `discoverKeywords`, `resolveMessagesForDonor`, CRUD helpers |
| `frontend/src/utils/storage.js` | безопасный localStorage | `safeStorage` |
| `frontend/src/utils/text.js` | форматирование | `plural` |
| `frontend/src/config.js` | API URLs | `API_BASE`, `LOCAL_API_BASE` |
| `frontend/src/types.js` | JSDoc/shared types | type definitions |
| `frontend/src/constants/settings.js` | defaults/tabs/log buffer | `DEFAULT_SETTINGS`, `TABS`, `LOG_BUFFER` |
| `frontend/src/constants/nichePresets.js` | каталог ниш | `NICHE_PRESETS`, `resolveNichePresets`, `extractDonorNiche`, `resolveNicheCategory` |
| `frontend/src/constants/cities.js` | города | `CITIES_PRESETS` |

## Frontend: владельцы данных и API

### `frontend/src/App.jsx`

Главный composition component. Здесь должны оставаться данные, совместно используемые несколькими вкладками.

| Область | Что делает App | Куда передаёт |
|---|---|---|
| Auth | хранит token/user, проверяет `/api/auth/verify`, строит `authFetch`, делает logout при 401/403 | всем hooks и экранам через props |
| Profiles | загружает `/api/girls`, votes, donors; хранит основной массив и обработчики mutation | `ProfilesTab`, `StatisticsTab` callbacks |
| Settings | загружает `/api/settings`, нормализует defaults/presets/groups, debounce-сохраняет | `SettingsTab`, запуск workers/messages |
| Operations | start/stop collector, photo restore, TG batch, mass messages | `ControlsTab`, `ProfilesTab`, status hook |
| Logs | подключает `useLogStream`, очищает `/api/logs` | `ControlsTab` |
| Tabs | выбирает Auth или основной layout, монтирует активный экран | компоненты вкладок |

Не переносить в `App.jsx`: сортировку таблицы, локальное состояние modal/form, calendar geometry, раскрытые settings rows.

### Экранные контракты

| Компонент | Получает | Сам владеет | API/эффекты |
|---|---|---|---|
| `AuthPage.jsx` | `onLoginSuccess` | login/signup mode, form, validation/loading | auth server login/signup; возвращает session в App |
| `ProfilesTab.jsx` | profiles, settings, vote/TG/delete callbacks | filters UI, selection, pagination, local expansions | одиночный `/api/check-telegram`; остальные mutations через App callbacks |
| `ControlsTab.jsx` | bot state/actions, logs, session, `authFetch` | log grouping/filter, live-view refresh state | `/api/live-view`; start/stop/clear через callbacks |
| `StatisticsTab.jsx` | `authFetch` | sort/page/range/manual status, feedback toggle | `/api/stats`, `/api/stats/messages`, feedback status/start/stop |
| `ScheduleTab.jsx` | `authFetch` | visible week, slots, drag state, modal form, optimistic series | schedule slots/status/series CRUD |
| `SettingsTab.jsx` | settings/value setters, presets, `authFetch` | active subtab, loading, feedback UI state | feedback status/start/stop; settings persistence остаётся у App |

### Settings-компоненты: границы

| Компонент | Изменяет | Не должен делать |
|---|---|---|
| `AccountsSection` | один account, authorize/browser/warmup/cooldown commands | менять глобальную структуру settings вне переданного callback |
| `DonorsSettingsSection` | donors, keyword categories, bundles, category messages | напрямую отправлять DM или менять profiles |
| `DonorsListEditor` | текстовый список donors с локальным draft | сохранять API самостоятельно |
| `KeywordCategoriesTable` | composition categories/bundles rows | вычислять raw donor discovery - это `donorCategories.js` |
| `CategoryRowExpand` | сообщения раскрытой category/bundle | хранить глобальный selected row |
| `MessagesListEditor` | массив непустых message variants | выбирать сообщение для DM |
| `NichePresetsSection` | пользовательские niche definitions | менять встроенный каталог `NICHE_PRESETS` |
| `TelegramAgentSection` | bot token/start/pair operations | проверять Telegram username профилей |
| `DebouncedLinesTextarea` | локальный текст до debounce/blur commit | владеть backend persistence |

### Hooks

| Hook | Когда использовать | Поведение cleanup/error |
|---|---|---|
| `useLogStream` | поток логов активной сессии | AbortController, reconnect delay, ограничение buffer |
| `useOperationStatuses` | общие долгие операции App | polling только при `enabled`; обновляет profiles после завершения нужных операций |
| `usePersistedFilters` | фильтры `ProfilesTab` | читает/валидирует localStorage, сохраняет изменения |
| `useCollapsed` | независимый collapsible UI | ключ localStorage определяет отдельное состояние |

### Utils: правила размещения логики

| Логика | Файл | Причина |
|---|---|---|
| Фильтрация массива profiles | `utils/profileFilters.js` | чистая функция; UI только передаёт options |
| Извлечение Telegram/bio/photo | `utils/profile.js` | единая нормализация для App/Profiles/DonorInfo |
| Нормализация donor URL/username | `utils/donor.js` | одинаковые ключи поиска и отображения |
| Categories/bundles/messages | `utils/donorCategories.js` | миграции модели, derived stats и immutable CRUD в одном месте |
| Browser storage с обработкой ошибок | `utils/storage.js` | компоненты не обращаются к localStorage напрямую без причины |
| Русские формы чисел | `utils/text.js` | `plural` и текстовая нормализация |

## Связь UI с CSS

| Компоненты | Основной CSS |
|---|---|
| App shell, header, navigation | `base.css`, `layout.css` |
| Profiles/Statistics/common tables/modals | `components.css`, `utilities.css` |
| Controls/logs/live view | `controls.css` |
| Settings и все `components/settings/*` | `settings.css` |
| ScheduleTab/EventModal | `schedule.css` |
| AuthPage | `auth.css` |

## Frontend: стили

`frontend/src/index.css` только импортирует профильные файлы.

| Файл | Область |
|---|---|
| `frontend/src/styles/base.css` | reset, variables, body, header/navigation |
| `frontend/src/styles/layout.css` | панели и responsive layout |
| `frontend/src/styles/components.css` | buttons, inputs, tables, modals |
| `frontend/src/styles/settings.css` | settings, accounts, donors, categories |
| `frontend/src/styles/controls.css` | controls, logs, live view |
| `frontend/src/styles/schedule.css` | календарь и slots |
| `frontend/src/styles/auth.css` | login/signup |
| `frontend/src/styles/utilities.css` | utilities и часть statistics |
| `frontend/src/styles/monochrome.css` | theme overrides |

## Служебные файлы

| Файл | Назначение |
|---|---|
| `backend/e2e/index-stub.js` | stub worker для E2E |
| `backend/e2e/parser-stub.js` | stub parser для E2E |
| `backend/scripts/update_is_in_city.js` | разовая миграция |
| `backend/scripts/patch-playwright-mcp.js` | postinstall patch Playwright |
| `build.bat` | Windows production build; только по явному запросу |
| `playwright*.config.js` | E2E-конфигурации |

## Поиск, если MAP устарел

```powershell
tgrep -n functionName backend frontend/src
tgrep -n api/path backend/routes
tgrep -n moduleName|symbolName backend frontend/src
```

Если `tgrep` отсутствует или не поддерживает Windows glob, использовать такой же узкий запрос через `rg`. Полный scan репозитория не запускать.
