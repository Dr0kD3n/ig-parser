# ANTIGRAVITY | mode:zen-token

<gates label="GLOBAL">
MAX_SENTENCES: 3
TONE: clinical
AUTO_CONTEXT: scoped-only
</gates>

<rules>
THINKING: normal

# Игнорировать при поиске/чтении (см. также .gitignore, .cursorignore)
EXCLUSIONS: node_modules, .git, .gemini, dist, build, tmp, logs, data, exports, export-data, coverage, playwright-report, test-results, .memory, agent-transcripts, .agents (без запроса), backend/public/assets, backend/logs.json, data/logs, logs.json, *.sqlite*, *.log, .env
READ: не открывать agent-transcripts и логи без явного запроса

# Экономия токенов
CONTEXT: только файлы, нужные для задачи; не листать корень репо; не перечитывать неизменённые файлы
SEARCH: сначала grep с path; semantic — если символ неизвестен; лимитировать выдачу
READ: большие файлы — offset/limit; не открывать бинарники, БД, собранные бандлы
SKILLS: читать SKILL.md только если скилл релевантен задаче
TESTS: не запускать npm test / vitest без явной просьбы; исключения — починка тестов/CI, коммит по запросу
OUTPUT: минимальный diff, короткий ответ, цитаты по строкам — не весь файл
</rules>
