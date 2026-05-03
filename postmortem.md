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

## 2026-05-02 - Test Suite Execution
- Issue: Missing unit tests for ingestion and processing layers.
- Fix: Created comprehensive test suites (24 tests total).
- Issue: Ingestion `process_and_send()` had two bugs caught by tests:
  - Early returns didn't call `producer.flush()`, breaking Kafka delivery guarantees.
  - Malformed flight records (with fewer columns than expected) weren't being skipped.
- Root cause: Implementation assumed all OpenSky API data was well-formed and didn't ensure flushing on edge cases.
- Fix: Always flush producer; validate state array length before processing.
- Risk remaining: PySpark processing layer tests not yet run (require Spark session setup).

## 2026-05-02 - Infrastructure & Documentation Completion
- **Kafka UI Fix**: Corrected bootstrap server from `localhost:9092` to `kafka:29092` for Docker container communication.
- **Spark Cluster Setup**: Added Apache Spark 3.5.0 master and worker services to Docker Compose; both include bundled Java.
- **Documentation**:
  - Updated `engineering log.md` with Phase 1 timeline and recent infrastructure changes.
  - Created `docs/INFRASTRUCTURE_SETUP.md` (2.5KB): Complete infrastructure reference with service configs, access points, environment variables, data flow, and persistence details.
  - Created `docs/TROUBLESHOOTING.md` (8KB): Comprehensive troubleshooting guide with diagnostic commands, common issues, and fixes for each service.
  - Created `docs/README.md`: Documentation index and quick start guide linking all resources.
- **All documentation in `/home/wyckie/Desktop/MyProjects/opensky_analytics/docs/`**
- **Stack Status**: 6 services running (Zookeeper, Kafka, Kafka UI, PostgreSQL, Spark Master, Spark Worker); 24 unit tests passing; infrastructure fully operational.

## 2026-05-03 - Build Target CI/CD Failures
- Issue: CI lint job failed with "no such service: ingestion" when running `docker compose run`.
- Root cause: Lint targets (`lint-ingestion`, `lint-processing`) used `docker compose run --no-deps` to reference compose services, which fails in CI where full stack not running.
- Solution: Switched lint targets from `$(COMPOSE) run` to direct `docker build -f Dockerfile && docker run --rm image` approach.
- Issue (Follow-up): `build-images` target also failed in CI with "no such service: backend".
- Root cause: Same as above—`build-images` used `$(COMPOSE) build backend ingestion sink`, which requires service definitions to exist.
- Solution: Changed to direct `docker build` commands for each layer (backend, ingestion, processing).
- Result: All Makefile targets now work independently in CI without depending on docker-compose service definitions.
- Pattern: CI/CD tasks that build or lint should use bare Docker commands, not compose service references.
- Documentation: Added 4 monitoring screenshots to README.md showing operational pipeline (Kafka UI, Spark Master, Spark App Detail, PostgreSQL data).
- Status: All infrastructure, linting, and build targets now functional in CI.
