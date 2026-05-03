# OpenSky Analytics CI/CD

This repository uses a Docker-first workflow so local development and CI run the same service graph.

## Lint Stage

Run lint checks before tests and runtime startup:

```bash
make lint
```

That target currently runs:

- Go formatting checks and `go vet` in `backend_layer`
- `ruff check` in `ingestion_layer`
- `ruff check` in `processing_layer`

## Runtime Service Order

1. `zookeeper`
2. `kafka`
3. `postgres`
4. `spark-master`
5. `spark-worker`
6. `backend` (Go API)
7. `sink` (`processing_layer/sink_to_db.py`)
8. `spark-job` (`processing_layer/process_flights.py` via `spark-submit`)
9. `ingestion` (`ingestion_layer/ingest.py`)

## Local Run

Use the Makefile from the repo root:

```bash
make start
```

What this does:

- Starts infrastructure containers with Docker Compose
- Creates Kafka topics
- Creates the PostgreSQL `flights_processed` table
- Builds the runtime images for `backend`, `ingestion`, and `sink`
- Starts the backend, sink, Spark job, and ingestion container in Docker

To stop everything:

```bash
make stop
```

## Test Layout

Each layer keeps tests in its own `test/` folder:

- `ingestion_layer/test/test_ingest.py`
- `processing_layer/test/test_sink.py`
- `processing_layer/test/test_process_flights.py`
- `backend_layer/test/backend_test.go`

Run them with:

```bash
make test
```

## CI Pipeline

The CI pipeline should:

1. Run lint checks
2. Run the Python and Go test suites
3. Start infrastructure containers
4. Create Kafka topics and PostgreSQL schema
5. Build the Docker images
6. Start the backend, sink, and Spark job containers
7. Smoke-test the backend `/health` endpoint

The ingestion container is intentionally left out of CI smoke runs because it polls the live OpenSky API and would make the pipeline depend on an external service.

## CD Notes

There is no external deploy target yet. The current delivery target is a reproducible Docker Compose stack, which is enough for local development and GitHub Actions smoke validation.

## Workflow File

Recommended path: `.github/workflows/ci-cd.yml`

The workflow should mirror the lint, test, and Docker startup stages documented above.