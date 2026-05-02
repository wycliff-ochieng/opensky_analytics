# Concepts

## Data Engineering Concepts Captured (Phase 1)
- Streaming ingestion: OpenSky poller publishes raw events to Kafka topic `flights_raw`.
- Stream processing: Spark reads raw topic, filters/enriches events, and emits to `flights_processed`.
- Materialization: A sink consumer persists processed events into PostgreSQL for query serving.
- Serving layer: API reads from PostgreSQL instead of Kafka directly for stable query semantics.
- Append-only storage: Keeps full event history and makes pipeline debugging easier in early phases.
- Bounded API reads: `limit` default/max prevents unbounded scans and protects service performance.

## Validation Concepts
- Module-scoped build context: Go commands should run inside `backend_layer` because the module root is there.
- Source-only hygiene: Syntax/build checks can produce local artifacts, so cleanup should be part of the validation loop.
- Compose compatibility: Deprecated keys (like top-level `version`) still work but should be removed to reduce future confusion.
