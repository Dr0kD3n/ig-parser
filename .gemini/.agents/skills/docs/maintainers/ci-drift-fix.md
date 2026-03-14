# CI Drift Fix Guide

**Problem**: The failing job is caused by uncommitted changes detected in `README.md`, `skills_index.json`, or catalog files after the update scripts run.

**Error**:

```
❌ Detected uncommitted changes produced by registry/readme/catalog scripts.
```

**Cause**:
Scripts like `tools/scripts/generate_index.py`, `tools/scripts/update_readme.py`, and `tools/scripts/build-catalog.js` modify `README.md`, `skills_index.json`, `data/catalog.json`, `data/bundles.json`, `data/aliases.json`, and `CATALOG.md`. The workflow expects these files to have no changes after the scripts run. Any differences mean the committed repo is out-of-sync with what the generation scripts produce.

## Pull Requests vs Main

- **Pull requests**: generated drift is reported as an informational notice only. Shared files like `README.md`, `CATALOG.md`, and `data/catalog.json` can legitimately move as other PRs merge. Do not treat PR drift as a merge blocker by itself.
- **`main` pushes**: drift is still strict. `main` must end the workflow clean after the auto-sync step.

## How to Fix on `main`

1. Run the **FULL Validation Chain** locally:

   ```bash
   npm run chain
   npm run catalog
   ```

2. Check for changes:

   ```bash
   git status
   git diff
   ```

3. Commit and push any updates:
   ```bash
   git add README.md skills_index.json data/catalog.json data/bundles.json data/aliases.json CATALOG.md
   git commit -m "chore: sync generated registry files"
   git push
   ```

## Maintainer guidance for PRs

- Validate the source change.
- If merge conflicts touch generated registry files, keep `main`'s version for those files, rerun `npm run chain` and `npm run catalog`, and push the refreshed branch.
- Let `main` auto-sync the final generated artifact set after merge.

**Summary**:
Use generator drift as a hard failure only on `main`. On PRs, it is expected maintenance noise around shared generated artifacts and should be handled with branch refreshes, not blanket rejection.
