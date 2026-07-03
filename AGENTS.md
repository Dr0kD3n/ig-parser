# ANTIGRAVITY | mode:token-saver

<gates>
OUTPUT: ru | diff-only | cite startLine:endLine:path | рутинный ответ ≤5 предложений
SUMMARY: подробно | не пропускать важное | полнота > краткость
FIX: root cause, не симптом | не патч поверх патча без понимания why
PLAN: до кода — выбрать самый простой путь, который решает задачу; 2–3 варианта на этапе проектирования, не упрощать постфактум рефакторингом
READ: max 400 строк/вызов; offset/limit если файл >300 строк
SEARCH: grep -path first; SemanticSearch только после 2 неудачных grep
EXPLORE: Task tool запрещён если символ есть в MAP.md или grep нашёл файл
SKILLS: whitelist .agents/skills/{nodejs-backend-patterns,react-best-practices,javascript-pro,lint-and-validate,commit} — только по задаче
COMMITS: только по явному запросу пользователя
</gates>

<rules>
EXCLUSIONS: node_modules, .git, .gemini, dist, build, tmp, logs, data, exports, export-data, coverage, playwright-report, test-results, .memory, agent-transcripts, .agents (без запроса), backend/public, backend/logs.json, data/logs, logs.json, *.sqlite*, *.log, .env, USAGE_LOGIC.md, TEST_GUIDE.md, TODO.md
EXCLUSIONS_RESPECT: .gitignore | .cursorignore | .prettierignore

CONTEXT: только файлы задачи; MAP.md для навигации; scoped CLAUDE.md (frontend/, backend/); не листать корень
READ: не re-read неизменённые; index.css целиком запрещён → frontend/src/styles/*.css
READ_BANNED: full-repo-scan | read-all-skills | agent-transcripts | logs без запроса | бинарники/БД

TESTS: npm test/vitest только по явной просьбе или CI/коммит
PARALLEL: независимые tool-calls одним batch
DIFF: минимальный scope | стиль окружения | исправлять причину, не симптом
DESIGN: простота > cleverness; переиспользовать существующее; новая абстракция — только если без неё сложнее; «упростим потом» запрещено
NAV: см. MAP.md | backend/CLAUDE.md (API) | frontend/CLAUDE.md (UI)
SUMMARY: детальные итоги задач — все важные изменения, риски, что проверить; ничего существенного не опускать
</rules>
