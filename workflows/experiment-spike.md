# Experiment / Spike

## Trigger
Event: a new tool, library, or pattern you want to try applying in this project.

## Steps
1. **Branch** — `git checkout -b spike/<thing>` or create a standalone script outside the main codebase.
2. **Prototype** — build the minimum viable version to learn what you need.
3. **Evaluate** — did it work? Is it worth integrating?
   - **Yes** → integrate into main codebase, update relevant configs/Dockerfiles, `make test`, `make start` to verify, then `git commit` to main.
   - **No** → discard the branch (`git branch -D spike/<thing>`) or delete the script. Optionally write a note about what you learned.

## Checkpoints
None.

## Brief
N/A.
