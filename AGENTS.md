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
EXCLUSIONS: node_modules, .git, .gemini, dist, build, tmp, logs, *.sqlite, *.sqlite-journal
</rules>
