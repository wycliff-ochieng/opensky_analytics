# Postmortem

## 2026-04-21 - Phase 1 Implementation Checkpoint
- Issue: Existing backend only consumed Kafka and printed records; no queryable data store.
- Root cause: Missing persistence and API serving boundaries in current architecture.
- Fix: Added PostgreSQL + sink consumer + backend DB API endpoint.
- Issue: Dependency placement risk while adding sink requirements.
- Root cause: Initial dependency update targeted ingestion requirements file.
- Fix: Reverted ingestion requirements and created processing-specific requirements file.
- Risk remaining: Full runtime integration still needs end-to-end service startup validation.

## 2026-04-21 - Validation Follow-up
- Issue: Running `go build ./...` from repo root failed.
- Root cause: Go module is rooted at `backend_layer`, not workspace root.
- Fix: Run Go build from `backend_layer`.
- Issue: Validation generated temporary artifacts (`__pycache__`, local backend binary).
- Root cause: Python compile and local Go build outputs.
- Fix: Removed generated files immediately after checks.
- Risk remaining: Runtime E2E data flow (Kafka -> Spark -> DB -> API) still unverified in a live stack.
