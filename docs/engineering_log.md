# Engineering Log

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

## 2026-05-02 - Stream Processing Architecture Update
- Documentation: Added a dedicated Kafka/Spark architecture guide in `docs/architecture.md` and refreshed the docs index.
- Stream processing: Clarified the 3 runtime jobs in the pipeline - ingestion producer, Spark Structured Streaming job, and PostgreSQL sink consumer.
- Execution: Spark now runs through containerized `spark-submit` inside `spark-master`, using `kafka:29092` on the Docker network.
- Notes: The Go backend remains the serving layer and reads from PostgreSQL rather than Kafka.
