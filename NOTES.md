# Notes

## Role

- Solo developer/operator of the OpenSky Analytics pipeline.

## Tools & Channels

- Development environment: local machine (Linux), `make start` for full stack
- Work style: focused bursts, one fix/feature per session
- No production deployment — learning/showcase project
- Iterate via: change code → `make start` → check logs → commit
- Session triggers: bug noticed last time, feature from skystream_system_desgn.md, new tool/pattern to try
- Task tracking: mental list + a few GitHub Issues
- Mid-session bugs: fixed immediately ("while I'm here")
- Features tracked in head or as references to skystream_system_desgn.md

## Typical Bug-Fix Session Steps

1. `git pull` or `git status` to check where you left off
2. Find the relevant code (search or recall)
3. Make the change
4. `make test` to run relevant tests
5. `make start` to spin up the stack
6. Curl the API or check logs to verify the fix
7. `git commit` and maybe `git push`

## Session Types

| Type | Planning | Approach | Commit timing |
|------|----------|----------|--------------|
| Bug fix | None | Direct edit | After verify |
| Feature | Light (re-read design doc, think layers) | Direct edit | After verify |
| Experiment/Spike | None separate branch/script | Branch off | After integration |

## Re-orientation

- After a break: `git log`, `git status`, re-read design doc parts
- Want: a lightweight session note ("last: X; next: Y") visible on return

## Stack Reset

- Trigger: stale data in Kafka/Postgres, bad state
- Action: `make clean` or `docker compose down -v` then `make start`
- No consistent trigger for when to do it

## Testing

- Full `make test` before every commit
- Layer-specific tests during development iteration
