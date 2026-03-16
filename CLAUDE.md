# ANTIGRAVITY | mode:HAM | optimize:max-efficiency

## Context Routing
→ backend: backend/CLAUDE.md
→ frontend: frontend/CLAUDE.md
→ tests: tests/CLAUDE.md
→ scripts: scripts/CLAUDE.md

<gates label="GLOBAL-GATES">
TOKEN-SAVER:
  trigger: every-prompt
  action: max-sentences=5-7 | clinical-tone
  persist: always

MEMORY-ROUTING:
  trigger: task-in-directory
  action: load-relevant-CLAUDE.md-only
</gates>

<rules>
THINKING: minimal-tokens | avoid-redundant-research
EVIDENCE: cite-data | line-numbers | proof-first
</rules>
