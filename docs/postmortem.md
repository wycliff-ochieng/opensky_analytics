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

## 2026-05-02 - Stream Processing Follow-up
- Issue: The Spark job was still being launched from the host in earlier attempts.
- Root cause: Host PySpark depended on local Java, but this machine did not provide a usable Java runtime for `SparkSession`.
- Fix: Run `processing_layer/process_flights.py` through `spark-submit` inside the `spark-master` container instead of the host Python interpreter.
- Issue: Kafka UI originally loaded without showing cluster data.
- Root cause: The UI was pointed at the wrong bootstrap address for Docker networking.
- Fix: Use `kafka:29092` inside containers and `localhost:9092` only from the host.
- Risk remaining: Live end-to-end verification still depends on actual OpenSky input, Spark output on `flights_processed`, and row growth in PostgreSQL.

## 2026-05-03 - Backend Layer Repair
- Issue: Backend Go sources were malformed and would not parse.
- Root cause: Duplicated package/import blocks and a merged test file left `main.go`, `app.go`, and the backend test file syntactically invalid.
- Fix: Rewrote the backend entrypoint, app package, and backend tests into valid Go files.
- Issue: CI had no explicit lint stage.
- Root cause: The workflow only ran tests and smoke checks.
- Fix: Added lint targets and wired them into CI before the slower test and startup stages.
