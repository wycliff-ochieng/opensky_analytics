# Bug Fix

## Trigger
Event: you noticed a bug — either during a previous session (mental note), during the current session ("while I'm here"), or via a GitHub Issue.

## Steps
1. **Orient** — `git status` or `git log` to find where you left off.
2. **Locate** — find the relevant code (recall, grep, or file search).
3. **Fix** — make the code change.
4. **Test** — run `make test` (full suite).
5. **Verify** — `make start` to spin up the stack, then curl the API or check logs.
6. **Commit** — `git commit` with a concise message.
7. **Push** — `git push` (optional, typically done).

## Checkpoints
None.

## Brief
N/A.
