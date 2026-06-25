# Session Handoff

## Trigger
Event: end of a work session (committing and walking away).

## Steps
1. **Auto-generate note** — capture the last commit message and `git diff --stat` into `SESSION.md` (automated, not hand-written).
2. **Commit and push** — `git commit`, `git push`.
3. **(On return) Re-orient** — read `SESSION.md`, `git pull`, `git status`.

## Checkpoints
None.

## Brief
N/A.
