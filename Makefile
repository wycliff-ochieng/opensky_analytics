SHELL := /bin/bash
.ONESHELL:

ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
COMPOSE := docker compose -f $(ROOT_DIR)/docker-compose.yaml
BACKEND_DIR := $(ROOT_DIR)/backend_layer

.PHONY: all up wait-kafka create-topics create-schema build-images run-apps run-ingest start stop logs clean lint lint-backend lint-ingestion lint-processing test test-ingestion test-processing test-backend

all: start

up:
	@echo "Bringing up infrastructure services..."
	$(COMPOSE) up -d --build zookeeper kafka kafka-ui postgres spark-master spark-worker

wait-kafka:
	@echo "Waiting for Kafka to be ready..."
	@until docker exec kafka kafka-topics --bootstrap-server kafka:29092 --list >/dev/null 2>&1; do sleep 1; done
	@echo "Kafka is ready."

create-topics: wait-kafka
	@echo "Creating Kafka topics if missing..."
	docker exec kafka kafka-topics --create --topic flights_raw --partitions 12 --replication-factor 1 --bootstrap-server kafka:29092 || true
	docker exec kafka kafka-topics --create --topic flights_processed --partitions 3 --replication-factor 1 --bootstrap-server kafka:29092 || true
	docker exec kafka kafka-topics --create --topic flights_alerts --partitions 3 --replication-factor 1 --bootstrap-server kafka:29092 || true
	@echo "Topics:"
	docker exec kafka kafka-topics --list --bootstrap-server kafka:29092

create-schema:
	@echo "Creating flights_processed table in Postgres (if not exists)..."
	docker exec postgres psql -U opensky -d opensky -c "CREATE TABLE IF NOT EXISTS flights_processed (id BIGSERIAL PRIMARY KEY, icao24 TEXT NOT NULL, callsign TEXT, origin_country TEXT, time_position BIGINT, last_contact BIGINT, longitude DOUBLE PRECISION, latitude DOUBLE PRECISION, baro_altitude DOUBLE PRECISION, on_ground TEXT, velocity DOUBLE PRECISION, true_track DOUBLE PRECISION, vertical_rate DOUBLE PRECISION, timestamp BIGINT NOT NULL, velocity_kmh DOUBLE PRECISION, status TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"
	docker exec postgres psql -U opensky -d opensky -c "CREATE INDEX IF NOT EXISTS idx_flights_processed_timestamp ON flights_processed (timestamp DESC);"
	@echo "Postgres schema ensured."

build-images:
	@echo "Building application images..."
	docker build -f $(ROOT_DIR)/backend_layer/Dockerfile -t opensky-backend $(ROOT_DIR)/backend_layer
	docker build -f $(ROOT_DIR)/ingestion_layer/Dockerfile -t opensky-ingestion $(ROOT_DIR)/ingestion_layer
	docker build -f $(ROOT_DIR)/processing_layer/Dockerfile -t opensky-sink $(ROOT_DIR)/processing_layer
	docker build -f $(ROOT_DIR)/frontend/Dockerfile -t opensky-frontend $(ROOT_DIR)/frontend

run-apps:
	@echo "Starting containerized application services..."
	$(COMPOSE) up -d --build backend sink spark-job frontend

run-ingest:
	@echo "Starting ingestion container..."
	$(COMPOSE) up -d --build ingestion

start: up create-topics create-schema build-images run-apps run-ingest
	@echo "All services started in Docker. Use '$(COMPOSE) ps' and '$(COMPOSE) logs -f' to inspect them."

stop:
	@echo "Stopping all services..."
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=100

clean: stop
	@echo "Removing images, volumes, and local artifacts..."
	$(COMPOSE) down -v --rmi local
	rm -rf logs bin .*.pid
	@echo "Clean complete."

lint: lint-backend lint-ingestion lint-processing

lint-backend:
	@echo "Linting backend layer..."
	cd $(BACKEND_DIR) && test -z "$$(gofmt -l $$(find . -name '*.go' -not -path './vendor/*'))"
	cd $(BACKEND_DIR) && go vet ./...

lint-ingestion:
	@echo "Linting ingestion layer..."
	docker build -f $(ROOT_DIR)/ingestion_layer/Dockerfile -t opensky-ingestion-lint $(ROOT_DIR)/ingestion_layer
	docker run --rm opensky-ingestion-lint ruff check ingest.py test

lint-processing:
	@echo "Linting processing layer..."
	docker build -f $(ROOT_DIR)/processing_layer/Dockerfile -t opensky-sink-lint $(ROOT_DIR)/processing_layer
	docker run --rm opensky-sink-lint ruff check process_flights.py sink_to_db.py test

test-ingestion:
	@echo "Running ingestion tests inside Docker..."
	$(COMPOSE) run --rm --no-deps --build ingestion pytest test/test_ingest.py -v

test-processing:
	@echo "Running processing tests inside Docker..."
	$(COMPOSE) run --rm --no-deps --build sink pytest test/test_sink.py test/test_process_flights.py -v

test-backend:
	@echo "Running backend tests in Go..."
	cd $(BACKEND_DIR) && go test ./...

test: test-ingestion test-processing test-backend
