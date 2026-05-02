# Infrastructure Setup Guide

This document describes the infrastructure stack for the OpenSky Analytics project, including all services, their roles, and configuration.

## Overview

The project uses Docker Compose to orchestrate a complete data pipeline infrastructure:

```
OpenSky API
    ↓
┌─────────────────────────────────────────────────────────┐
│                   Docker Compose Stack                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Zookeeper ─→ Kafka ─→ Kafka UI (localhost:8100)       │
│                          │                              │
│                          ├─→ Spark Processing           │
│                          │                              │
│                          └─→ Sink Consumer              │
│                                    │                    │
│                                    ↓                    │
│                            PostgreSQL (5432)             │
│                                    │                    │
│                                    ↓                    │
│                         Go Backend API (8000)            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Services Configuration

### 1. Zookeeper
**Purpose**: Manages Kafka cluster metadata and leader election.

**Configuration**:
- Image: `confluentinc/cp-zookeeper:6.1.0`
- Container: `zookeeper`
- Port: 2181 (internal)
- Environment:
  - `ZOOKEEPER_CLIENT_PORT: 2181`
  - `ZOOKEEPER_TICK_TIME: 2000`

### 2. Kafka Broker
**Purpose**: Distributed message broker; receives raw and processed flight data.

**Configuration**:
- Image: `confluentinc/cp-kafka:6.1.0`
- Container: `kafka`
- Ports:
  - `9092` - External (host access)
  - `29092` - Internal (Docker network)
- **Key Topics**:
  - `flights_raw` - Raw OpenSky API data (ingestion → Kafka)
  - `flights_processed` - Enriched flight data (Spark → Kafka → PostgreSQL sink)
- Environment:
  - `KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181`
  - `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:29092,PLAINTEXT_HOST://localhost:9092`

**Bootstrap Servers**:
- **From host**: `localhost:9092`
- **From Docker containers**: `kafka:29092` ← Use for internal services

### 3. Kafka UI
**Purpose**: Web interface for monitoring Kafka topics, brokers, and consumer groups.

**Configuration**:
- Image: `provectuslabs/kafka-ui:latest`
- Container: `kafka-ui`
- **Port**: `8100` (http://localhost:8100)
- Environment:
  - `KAFKA_CLUSTERS_0_NAME: local`
  - `KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:29092` ← Use internal address

**Features**:
- View topics and their messages
- Monitor consumer groups
- Consumer lag tracking
- Broker health status

### 4. PostgreSQL
**Purpose**: Persistent data store for processed flight records.

**Configuration**:
- Image: `postgres:16-alpine`
- Container: `postgres`
- Port: `5432`
- Credentials:
  - User: `opensky`
  - Password: `opensky`
  - Database: `opensky`
- Volume: `postgres_data` (named volume for persistence)

**Schema** (auto-created by backend on startup):
```sql
CREATE TABLE flights_processed (
    id SERIAL PRIMARY KEY,
    icao24 VARCHAR(6),
    callsign VARCHAR(8),
    origin_country VARCHAR(50),
    time_position BIGINT,
    last_contact BIGINT,
    longitude DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    baro_altitude DOUBLE PRECISION,
    on_ground BOOLEAN,
    velocity DOUBLE PRECISION,
    true_track DOUBLE PRECISION,
    vertical_rate DOUBLE PRECISION,
    timestamp BIGINT,
    velocity_kmh DOUBLE PRECISION,
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX flights_timestamp_idx ON flights_processed (timestamp DESC);
```

### 5. Apache Spark Cluster
**Purpose**: Distributed stream processing; transforms raw Kafka data and enriches flight records.

#### Spark Master
- Image: `apache/spark:3.5.0`
- Container: `spark-master`
- Ports:
  - `7077` - Spark Master RPC
  - `8080` - Master WebUI (http://localhost:8080)
- Bundled with Java; no external Java required

#### Spark Worker
- Image: `apache/spark:3.5.0`
- Container: `spark-worker`
- Ports:
  - `8081` - Worker WebUI (http://localhost:8081)
- Environment:
  - `SPARK_MASTER_URL: spark://spark-master:7077`
  - `SPARK_WORKER_MEMORY: 2G`
  - `SPARK_WORKER_CORES: 2`

**Processing Job** (`process_flights.py`):
- Reads from Kafka topic: `flights_raw`
- Applies transformations:
  - Filters valid coordinates (lat/lon not null)
  - Converts velocity to km/h
  - Determines flight status (CLIMBING/DESCENDING/CRUISING)
- Writes to Kafka topic: `flights_processed`

### Runtime Jobs and How They Connect

| Job | File | Entry point | Reads | Writes |
| --- | --- | --- | --- | --- |
| Ingestion | `ingestion_layer/ingest.py` | `main()` | OpenSky API | Kafka `flights_raw` |
| Stream processing | `processing_layer/process_flights.py` | module body via `spark-submit` | Kafka `flights_raw` | Kafka `flights_processed` |
| Sink to DB | `processing_layer/sink_to_db.py` | `main()` | Kafka `flights_processed` | PostgreSQL `flights_processed` table |

The Go backend is a query service. It reads PostgreSQL only; it does not consume Kafka.

### Function Wiring

- `ingestion_layer/ingest.py`
  - `create_kafka_producer()` connects to Kafka with retries.
  - `fetch_flight_data()` pulls one OpenSky snapshot.
  - `process_and_send()` validates each aircraft state, adds `timestamp`, and publishes to `flights_raw`.
  - `main()` is the infinite poll loop.
- `processing_layer/process_flights.py`
  - Builds a Spark session against `spark://spark-master:7077`.
  - Reads `flights_raw` with `readStream`.
  - Parses JSON, filters invalid coordinates, calculates `velocity_kmh`, and assigns `status`.
  - Writes to `flights_processed` with checkpointing.
- `processing_layer/sink_to_db.py`
  - `create_consumer()` reads from `flights_processed`.
  - `create_db_connection()` opens PostgreSQL with retry logic.
  - `normalize()` maps Kafka payload fields into the SQL insert shape.
  - `main()` commits each processed row into PostgreSQL.

### Job Count

There are 3 long-running runtime jobs in the pipeline:

1. Ingestion producer.
2. Spark streaming processor.
3. PostgreSQL sink consumer.

The backend API is not counted as a stream job because it only serves queries from the database.

## How to Start the Stack

### 1. Start All Services
```bash
cd /home/wyckie/Desktop/MyProjects/opensky_analytics
docker compose up -d
```

### 2. Verify Services
```bash
docker compose ps
# Should show: zookeeper, kafka, kafka-ui, postgres, spark-master, spark-worker
```

### 3. Wait for Startup (30-60 seconds)
All services should transition from "Starting" to "Up".

## Access Points

| Service | URL/Address | Purpose |
|---------|-------------|---------|
| **Kafka** | `localhost:9092` | Produce/consume messages |
| **Kafka UI** | http://localhost:8100 | Monitor topics & brokers |
| **PostgreSQL** | `localhost:5432` | Query processed flights |
| **Spark Master** | http://localhost:8080 | Monitor cluster jobs |
| **Spark Worker** | http://localhost:8081 | Monitor worker tasks |
| **Backend API** | http://localhost:8000 | Query `/flights` endpoint |

## Environment Variables

Each component respects environment variables for runtime configuration:

### Ingestion Layer
```bash
KAFKA_BROKER=localhost:9092          # Default: localhost:9092
OPENSKY_URL=<url>                    # OpenSky API endpoint
POLL_INTERVAL_SECONDS=30             # Polling frequency
```

### Processing Layer (Spark)
```bash
KAFKA_BOOTSTRAP_SERVERS=kafka:29092  # Kafka broker address
INPUT_TOPIC=flights_raw              # Raw data topic
OUTPUT_TOPIC=flights_processed       # Enriched data topic
```

### Sink Layer (Postgres Writer)
```bash
KAFKA_BROKER=kafka:29092             # Kafka broker
KAFKA_TOPIC=flights_processed        # Topic to consume
DB_HOST=postgres                     # Postgres host
DB_PORT=5432                         # Postgres port
DB_NAME=opensky                      # Database name
DB_USER=opensky                      # Database user
DB_PASSWORD=opensky                  # Database password
```

### Backend API
```bash
DATABASE_URL=postgresql://opensky:opensky@postgres:5432/opensky
HTTP_ADDR=0.0.0.0:8000
```

## Data Flow

1. **Ingestion**: Python script polls OpenSky API, publishes raw records to Kafka `flights_raw` topic
2. **Processing**: Spark job reads `flights_raw`, applies transformations, writes to `flights_processed`
3. **Streaming Sink**: Python consumer reads `flights_processed`, inserts records into PostgreSQL
4. **Querying**: Go backend API reads from PostgreSQL, serves HTTP `/flights` endpoint
5. **Monitoring**: Kafka UI shows message flow, Spark UI shows job progress

This pipeline has 3 runtime jobs and 1 serving service. See [architecture.md](./architecture.md) for the function-level wiring.

## Persistence

- **PostgreSQL Volume**: `opensky_analytics_postgres_data` (stored on host)
  - Survives container restarts
  - Survives `docker compose down`
  - To reset data: `docker volume rm opensky_analytics_postgres_data`

- **Kafka Offsets**: Stored in Zookeeper; consumer groups resume from last committed offset

## Network

All services communicate via the default Docker Compose network: `opensky_analytics_default`

**Internal Addresses**:
- `zookeeper:2181`
- `kafka:29092`
- `postgres:5432`
- `spark-master:7077`
- `spark-worker:7077`

## Docker Compose File Location

`/home/wyckie/Desktop/MyProjects/opensky_analytics/docker-compose.yaml`

## Common Operations

### View Logs
```bash
docker logs <container_name>
docker logs -f kafka                  # Follow Kafka logs
docker logs kafka-ui                  # View Kafka UI startup
```

### Execute Commands in Containers
```bash
docker exec -it postgres psql -U opensky -d opensky
docker exec -it kafka kafka-topics --list --bootstrap-server kafka:29092
```

### Submit the Spark Job
```bash
docker exec \
  -e SPARK_MASTER=spark://spark-master:7077 \
  -e KAFKA_BOOTSTRAP_SERVERS=kafka:29092 \
  -e INPUT_TOPIC=flights_raw \
  -e OUTPUT_TOPIC=flights_processed \
  spark-master /opt/spark/bin/spark-submit \
  --master spark://spark-master:7077 \
  --deploy-mode client \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
  --conf spark.jars.ivy=/tmp/.ivy2 \
  /opt/spark-apps/process_flights.py
```

### Stop Stack
```bash
docker compose down
```

### Remove All Data (Hard Reset)
```bash
docker compose down -v                # Remove named volumes
docker system prune -a                # Remove unused images
```

## Troubleshooting Reference

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for detailed debugging commands and common issues.
