# Concepts

## Data Engineering Concepts Captured (Phase 1)
- Streaming ingestion: OpenSky poller publishes raw events to Kafka topic `flights_raw`.
- Stream processing: Spark reads raw topic, filters/enriches events, and emits to `flights_processed`.
- Materialization: A sink consumer persists processed events into PostgreSQL for query serving.
- Serving layer: API reads from PostgreSQL instead of Kafka directly for stable query semantics.
- Runtime job split: the pipeline has 3 long-running jobs - ingestion producer, Spark processing job, and PostgreSQL sink consumer. The Go API is a serving service, not a stream job.
- Containerized Spark execution: the Spark job runs through `spark-submit` inside the `spark-master` container, so host Java is not required.
- Append-only storage: Keeps full event history and makes pipeline debugging easier in early phases.
- Bounded API reads: `limit` default/max prevents unbounded scans and protects service performance.
- Kafka network split: host tools use `localhost:9092`, while containers use `kafka:29092`.

## Validation Concepts
- Module-scoped build context: Go commands should run inside `backend_layer` because the module root is there.
- Source-only hygiene: Syntax/build checks can produce local artifacts, so cleanup should be part of the validation loop.
- Compose compatibility: Deprecated keys (like top-level `version`) still work but should be removed to reduce future confusion.
