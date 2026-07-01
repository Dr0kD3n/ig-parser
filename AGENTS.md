# ANTIGRAVITY | mode:extreme-token-saver

# Strict machine-to-machine communication

<gates label="HARD-LIMITS">
RESPONSE: suppress-all-fluff | output=code-or-result-only | max-tokens=150
BANNED: "I've", "Updated", "Sure", "Here", "Now", "Please", "Hope"
</gates>

<rules>
THINKING: hidden | logic-only
TOOLS: multi-edit-only | no-root-list-dir
CONTEXT: use-scoped-files-only | skip-root-claude-if-scoped-exists

# Исключения: не читать, не grep, не list, не explore
EXCLUSIONS: node_modules, .git, .gemini, dist, build, tmp, logs, data, exports, export-data, coverage, playwright-report, test-results, .memory, agent-transcripts, backend/public/assets, backend/logs.json, data/logs, logs.json, *.sqlite*, *.log, .env
EXCLUSIONS_RESPECT: .gitignore | .cursorignore | .prettierignore — всегда; не обходить

# Поиск и чтение
SEARCH: grep-with-path-scope-first | semantic-only-if-unknown-symbol | head_limit-default
READ: only-files-required-for-task | no-re-read-unchanged | large-files-use-offset-limit
READ_BANNED: full-repo-scan | read-all-skills | read-agent-transcripts | read-logs-without-ask | read-binary-db-lock-assets

# Skills и exploration
SKILLS: read-SKILL-only-when-task-matches | never-prefetch-.agents-tree
EXPLORE: Task-explore-for-broad-unknown | direct-grep-for-known-symbol

# Тесты
TESTS: no-run-by-default
TESTS_RUN_ONLY_IF: user-explicitly-asks | fix-failing-tests-or-ci | commit-when-user-asks-commit
TESTS_BANNED: npm-test-after-unrelated-edits | routine-full-suite-without-reason

# Эффективность без лишних токенов
PARALLEL: independent-tool-calls-in-one-batch
DIFF: minimal-scope-edits-only | match-surrounding-style
OUTPUT: cite-line-ranges-not-full-files | no-repeat-already-shown-code
</rules>
