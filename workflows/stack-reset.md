# Stack Reset

## Trigger
Event: stale data in Kafka/PostgreSQL, corrupted state, or wanting a clean slate before a new feature.

## Steps
1. **Confirm** — verify you want to wipe all data.
2. **Down** — `docker compose down -v` (wipes volumes).
3. **Up** — `make start` (rebuilds from clean state).
4. **Verify** — check that the ingestion layer is producing to Kafka and the pipeline flows end-to-end.

## Checkpoints
- **Confirm**: before `down -v`. A simple yes/no prompt: "This will wipe all Kafka topics and PostgreSQL rows. Proceed?"

## Brief
At the Confirm checkpoint: short safety prompt, no detail needed.
