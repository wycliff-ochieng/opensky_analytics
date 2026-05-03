# Engineering Log

## 2026-05-03 - Build Target Fixes & Documentation Screenshots
- Issue: `build-images` target failed in CI with "no such service: backend" (depends on compose service definitions).
- Fix: Changed `build-images` to use direct `docker build` commands instead of `$(COMPOSE) build`.
- Issue: `lint-ingestion` and `lint-processing` targets had same issue (using `docker compose run`).
- Fix: Changed lint targets to use `docker build -f Dockerfile + docker run` approach.
- Result: Both targets now work independently in CI without requiring compose service lookup.
- Documentation: Embedded 4 monitoring screenshots in README:
  - Kafka UI showing topics, partitions, and message counts (flights_raw: 1.1M messages, flights_processed: 1.0M messages)
  - Spark Master UI showing 1 running application (FlightDataProcessor)
  - Spark Application detail showing 2-core executor in RUNNING state
  - PostgreSQL terminal showing 749,587 processed flight records with enriched data (velocity_kmh, status)
- Visibility: Screenshots provide visual proof of full end-to-end data pipeline working correctly.

## 2026-04-21 - Phase 1 Start
- Decision: Begin with end-to-end slice (ingest -> process -> persist -> query).
- Infrastructure: Added PostgreSQL service to docker compose with named volume persistence.
- Backend: Replaced Kafka-print consumer with HTTP API and PostgreSQL schema bootstrap.
- Processing: Added new sink script to persist flights from `flights_processed` topic into PostgreSQL (append-only).
- Validation: Ran `go mod tidy && go build` in backend and Python compile checks for ingestion + sink.
- Next: Wire and run full stack end-to-end, then verify `/flights?limit=N` behavior.

## 2026-04-21 - Validation Checkpoint
- Commands: `go build ./...` (from `backend_layer`), `python3 -m py_compile ingestion_layer/ingest.py processing_layer/process_flights.py processing_layer/sink_to_db.py`, `docker compose config`.
- Result: Go and Python checks passed; compose parsed successfully.
- Note: Compose warns that `version` is obsolete and ignored.
- Cleanup: Removed generated artifacts (`backend_layer/opensky-backend`, `ingestion_layer/__pycache__`, `processing_layer/__pycache__`).

## 2026-05-02 - Test Implementation & Execution
- Ingestion tests: Created comprehensive test suite for `ingest.py` covering producer creation, retry logic, flight fetch, and data processing.
  - Issue found: `process_and_send()` didn't call `flush()` on early return; fix applied.
  - Issue found: Malformed flights with insufficient columns weren't skipped; added validation + skip logic.
  - Result: All 14 ingestion tests passing.
- Sink tests: Created comprehensive test suite for `sink_to_db.py` covering DB connection, retry logic, payload normalization, and consumer creation.
  - Result: All 10 sink tests passing.
- Test infrastructure: Set up Python venv with pytest, pytest-mock, kafka-python, requests, psycopg2-binary.
- Combined test run: 24 tests passing (14 ingestion + 10 sink).

## 2026-05-02 - Infrastructure & PySpark Setup
- **Kafka UI Fix**: Changed bootstrap server from `localhost:9092` to `kafka:29092` (internal Docker network) to resolve connection issues.
- **PySpark Installation**: Installed PySpark 3.5.0 and py4j in venv; identified Java requirement for local SparkContext.
- **Spark Cluster Setup**: Added Apache Spark 3.5.0 master and worker services to docker-compose.yaml:
  - Spark Master: Port 7077 (RPC), 8080 (WebUI)
  - Spark Worker: Port 8081 (WebUI)
  - Both containers come with bundled Java; no system-level Java installation needed.
- **Docker Compose Stack Status**: Zookeeper, Kafka, Kafka UI, PostgreSQL, Spark Master, Spark Worker all running.
- **Local PySpark Limitation**: Local Python environment needs Java for SparkContext; cluster submission via `spark-submit` recommended instead.
- **Next**: Create Dockerfile for Spark job submission or refactor tests to run inside Spark containers.

## 2026-05-03 - Backend Repair & Linting

## 2026-05-03 - CI Lint Target Fix
- Issue: CI workflow failed with "no such service: ingestion" when running `make lint`.
- Root Cause: Lint targets used `docker compose run` to reference services, which failed in CI environment where full compose stack isn't running.
- Solution: Changed lint-ingestion and lint-processing targets to use `docker build + docker run` instead of `docker compose run`.
- Result: `make lint` now works in both local and CI environments without depending on service definitions.
- Pushed: Commit 42b25de to main.
